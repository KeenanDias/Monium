const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const secretsManager = new AWS.SecretsManager();

const USERS_TABLE = "MoniumUsers";

// Sandbox by default. Switch to https://production.plaid.com only after
// Plaid approves production access.
const PLAID_API_URL = process.env.PLAID_API_URL || "https://sandbox.plaid.com";
// Origins allowed to call this API. Cloudflare preview deploys and local dev
// servers need to work alongside production, so the caller's origin is matched
// per request and echoed back - a browser rejects a wildcard as soon as the
// request carries an Authorization header.
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || "https://monium.ca,https://www.monium.ca"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  // Cloudflare serves each deployment at <hash>.<project>.pages.dev, so allow
  // any depth of subdomain rather than a single label
  /^https:\/\/([a-z0-9-]+\.)+pages\.dev$/,
];

function allowedOrigin(event) {
  const headers = (event && event.headers) || {};
  const origin = headers.origin || headers.Origin;

  if (!origin) return ALLOWED_ORIGINS[0];
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (ORIGIN_PATTERNS.some((re) => re.test(origin))) return origin;

  // Unrecognized origin: answer as production so the browser blocks it
  return ALLOWED_ORIGINS[0];
}

// Rebuilt at the start of each invocation so respond() stays a one-liner
let HEADERS = { "Content-Type": "application/json" };

const respond = (statusCode, body) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

// Pins this request's CORS headers and answers the preflight, which lets one
// integration serve both OPTIONS and POST instead of a separate mock method.
function beginRequest(event) {
  HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowedOrigin(event),
    Vary: "Origin",
  };

  if (event && event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...HEADERS,
        "Access-Control-Allow-Methods": "OPTIONS,POST",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Max-Age": "86400",
      },
      body: "",
    };
  }

  return null;
}

const LOOKBACK_DAYS = 90;
const DAYS_PER_MONTH = 30.44;

// Plaid's personal_finance_category.primary values, grouped into the buckets
// safe-to-spend actually cares about. Anything unmapped falls through to
// discretionary, which is the conservative choice - it lowers the number
// rather than inflating it.
const EXCLUDED_CATEGORIES = new Set([
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT", // moving money between your own accounts isn't spending
]);

// Multiply a recurring stream's per-occurrence amount by this to get its
// monthly cost.
const FREQUENCY_TO_MONTHLY = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  SEMI_MONTHLY: 2,
  MONTHLY: 1,
  ANNUALLY: 1 / 12,
};

async function getPlaidCredentials() {
  const secret = await secretsManager
    .getSecretValue({ SecretId: "monium/plaid-secret" })
    .promise();

  const parsed = JSON.parse(secret.SecretString);
  const clientId = parsed.client_id || process.env.PLAID_CLIENT_ID;

  if (!clientId || !parsed.secret) {
    throw new Error("monium/plaid-secret must contain client_id and secret");
  }

  return { clientId, secret: parsed.secret };
}

async function plaidRequest(path, payload, credentials) {
  const response = await fetch(`${PLAID_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      client_id: credentials.clientId,
      secret: credentials.secret,
    }),
  });

  const data = await response.json();

  if (!response.ok || data.error_code) {
    throw new Error(
      `Plaid ${path} failed: ${data.error_message || response.statusText}`,
    );
  }

  return data;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
}

// Plaid caps each response at 500, so page until we have them all
async function getAllTransactions(accessToken, credentials) {
  const transactions = [];
  let total = null;

  while (total === null || transactions.length < total) {
    const page = await plaidRequest(
      "/transactions/get",
      {
        access_token: accessToken,
        start_date: isoDaysAgo(LOOKBACK_DAYS),
        end_date: isoDaysAgo(0),
        options: { count: 500, offset: transactions.length },
      },
      credentials,
    );

    total = page.total_transactions;
    transactions.push(...page.transactions);

    if (page.transactions.length === 0) break; // guard against a stuck cursor
  }

  return transactions;
}

function primaryCategory(item) {
  return item.personal_finance_category?.primary || "OTHER";
}

function monthlyAmount(stream) {
  const perOccurrence = Math.abs(
    stream.average_amount?.amount ?? stream.last_amount?.amount ?? 0,
  );

  // UNKNOWN frequency means Plaid saw a pattern but couldn't pin the cadence.
  // Treating it as monthly is the safest read.
  return perOccurrence * (FREQUENCY_TO_MONTHLY[stream.frequency] ?? 1);
}

// Recurring outflows are the real definition of "committed" spending: Plaid
// has seen these repeat, so they're obligations rather than one-off purchases.
async function getCommittedSpending(accessToken, credentials) {
  const { outflow_streams: outflows = [], inflow_streams: inflows = [] } =
    await plaidRequest(
      "/transactions/recurring/get",
      { access_token: accessToken },
      credentials,
    );

  const commitments = outflows
    .filter((s) => s.is_active && !EXCLUDED_CATEGORIES.has(primaryCategory(s)))
    .map((s) => ({
      name: s.merchant_name || s.description,
      category: primaryCategory(s),
      frequency: s.frequency,
      monthlyAmount: Math.round(monthlyAmount(s) * 100) / 100,
    }));

  // Plaid also detects recurring *income*, which is more trustworthy than a
  // number the user typed from memory
  const incomeStreams = inflows.filter(
    (s) => s.is_active && primaryCategory(s) === "INCOME",
  );

  return {
    commitments,
    monthlyCommitted: commitments.reduce((sum, c) => sum + c.monthlyAmount, 0),
    detectedMonthlyIncome: incomeStreams.reduce(
      (sum, s) => sum + monthlyAmount(s),
      0,
    ),
    incomeStreams,
  };
}

// Average monthly spend per category, for the dashboard breakdown. The lookback
// covers ~3 months, so totals are scaled down to one month.
function monthlySpendByCategory(transactions) {
  const monthsCovered = LOOKBACK_DAYS / DAYS_PER_MONTH;
  const totals = {};

  transactions.forEach((t) => {
    const category = primaryCategory(t);

    // Plaid reports outflows as positive amounts
    if (t.amount <= 0 || EXCLUDED_CATEGORIES.has(category)) return;

    totals[category] = (totals[category] || 0) + t.amount;
  });

  Object.keys(totals).forEach((category) => {
    totals[category] = Math.round((totals[category] / monthsCovered) * 100) / 100;
  });

  return totals;
}

// How many days until the user's next paycheck. Budgeting to the real pay
// cycle is what makes the number feel right - a fixed 30 is wrong for anyone
// paid weekly or biweekly.
function daysUntilNextPayday(incomeStreams) {
  const today = new Date();

  const upcoming = incomeStreams
    .map((s) => s.predicted_next_date)
    .filter(Boolean)
    .map((d) => Math.ceil((new Date(d) - today) / (24 * 60 * 60 * 1000)))
    .filter((days) => days > 0);

  if (upcoming.length > 0) return Math.min(...upcoming);

  // No prediction available - fall back to the end of the current month
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return Math.max(1, Math.ceil((endOfMonth - today) / (24 * 60 * 60 * 1000)));
}

// Months to spread a savings goal over when the user gave no deadline. A goal
// is a total to reach, not a monthly bill - charging the full amount every month
// floors safe-to-spend at zero for anyone with a goal larger than their income.
const DEFAULT_GOAL_HORIZON_MONTHS = 12;

function monthlySavingsTarget(profile) {
  // An explicit per-month figure always wins
  if (profile.monthlySavings) return parseFloat(profile.monthlySavings);

  // Handles "$5,000" and "5000" alike - a bare parseFloat returns NaN on the
  // currency-formatted string the onboarding form accepts
  const raw = String(profile.goalAmount ?? profile.goal ?? "");
  const match = raw.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) return 0;

  const goalAmount = parseFloat(match[1]);

  const monthsRemaining = profile.goalTargetDate
    ? Math.max(
        1,
        (new Date(profile.goalTargetDate) - new Date()) /
          (DAYS_PER_MONTH * 24 * 60 * 60 * 1000),
      )
    : DEFAULT_GOAL_HORIZON_MONTHS;

  return goalAmount / monthsRemaining;
}

function monthlyIncomeFromProfile(profile) {
  if (profile.monthlyIncome) return parseFloat(profile.monthlyIncome);

  const income = parseFloat(profile.income);
  if (isNaN(income)) return 0;

  // Older records stored a single ambiguous "income" field. Treat it as annual
  // only when the profile explicitly says so.
  return profile.incomePeriod === "annual" ? income / 12 : income;
}

function calculateSafeToSpend(profile, committed, categoryBreakdown) {
  // Prefer what Plaid actually observed hitting the account over a
  // self-reported figure, which is usually pre-tax and from memory
  const statedIncome = monthlyIncomeFromProfile(profile);
  const monthlyIncome =
    committed.detectedMonthlyIncome > 0
      ? committed.detectedMonthlyIncome
      : statedIncome;

  const monthlySavings = monthlySavingsTarget(profile);
  const availableForSpending =
    monthlyIncome - committed.monthlyCommitted - monthlySavings;

  const daysRemaining = daysUntilNextPayday(committed.incomeStreams);
  const safeToSpendDaily = Math.max(0, availableForSpending / DAYS_PER_MONTH);

  const round = (n) => Math.round(n * 100) / 100;

  return {
    monthlyIncome: round(monthlyIncome),
    incomeSource:
      committed.detectedMonthlyIncome > 0 ? "plaid_detected" : "user_reported",
    statedMonthlyIncome: round(statedIncome),
    monthlyCommitted: round(committed.monthlyCommitted),
    commitments: committed.commitments,
    monthlySavings: round(monthlySavings),
    availableForSpending: round(availableForSpending),
    daysUntilNextPayday: daysRemaining,
    safeToSpendBeforePayday: round(Math.max(0, safeToSpendDaily * daysRemaining)),
    categoryBreakdown,
    safeToSpendDaily: round(safeToSpendDaily),
    calculatedAt: new Date().toISOString(),
  };
}

exports.handler = async (event) => {
  console.log("Process Transactions Lambda invoked");

  const preflight = beginRequest(event);
  if (preflight) return preflight;

  try {
    const body = JSON.parse(event.body || "{}");
    const { userId } = body;

    if (!userId) {
      return respond(400, { error: "Missing required field: userId" });
    }

    const credentials = await getPlaidCredentials();

    const userResult = await dynamodb
      .get({ TableName: USERS_TABLE, Key: { userId } })
      .promise();

    if (!userResult.Item) {
      return respond(404, { error: "User not found" });
    }

    // Onboarding is optional. Plaid-detected income is the more reliable source
    // anyway, so a missing profile just means no self-reported income and no
    // savings target - not a reason to refuse the whole calculation.
    const profile = userResult.Item.profile || userResult.Item.kyc || {};

    // The access token lives server-side only - it is written by
    // monium-plaid-exchange and never travels to or from the client
    const plaidAccessToken = userResult.Item.plaidAccessToken;

    if (!plaidAccessToken) {
      return respond(400, { error: "No bank account linked" });
    }

    const [transactions, committed] = await Promise.all([
      getAllTransactions(plaidAccessToken, credentials),
      getCommittedSpending(plaidAccessToken, credentials),
    ]);

    console.log(
      `Analyzed ${transactions.length} transactions, ` +
        `${committed.commitments.length} recurring commitments`,
    );

    const categoryBreakdown = monthlySpendByCategory(transactions);
    const safeToSpend = calculateSafeToSpend(
      profile,
      committed,
      categoryBreakdown,
    );

    // Store only the computed summary. Raw transactions stay at Plaid - keeping
    // a copy adds risk without adding capability, and would blow past
    // DynamoDB's 400KB item limit for heavy spenders.
    await dynamodb
      .update({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression: "SET safeToSpend = :s REMOVE transactions",
        ExpressionAttributeValues: { ":s": safeToSpend },
      })
      .promise();

    return respond(200, safeToSpend);
  } catch (error) {
    console.error("Error:", error);
    return respond(500, { error: error.message });
  }
};
