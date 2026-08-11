const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const secretsManager = new AWS.SecretsManager();

const USERS_TABLE = "MoniumUsers";

// Sandbox by default. Switch to https://production.plaid.com only after
// Plaid approves production access.
const PLAID_API_URL = process.env.PLAID_API_URL || "https://sandbox.plaid.com";

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

function monthlySavingsTarget(profile) {
  if (profile.monthlySavings) return parseFloat(profile.monthlySavings);

  // Derive from goal amount and target date when both are present
  const goalAmount = parseFloat(profile.goalAmount ?? profile.goal);
  if (isNaN(goalAmount)) return 0;

  if (profile.goalTargetDate) {
    const monthsRemaining = Math.max(
      1,
      (new Date(profile.goalTargetDate) - new Date()) /
        (DAYS_PER_MONTH * 24 * 60 * 60 * 1000),
    );
    return goalAmount / monthsRemaining;
  }

  return goalAmount;
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

  try {
    const body = JSON.parse(event.body || "{}");
    const { userId, plaidAccessToken } = body;

    if (!userId || !plaidAccessToken) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Missing required fields: userId, plaidAccessToken",
        }),
      };
    }

    const credentials = await getPlaidCredentials();

    const userResult = await dynamodb
      .get({ TableName: USERS_TABLE, Key: { userId } })
      .promise();

    if (!userResult.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "User not found" }),
      };
    }

    const profile = userResult.Item.profile || userResult.Item.kyc;

    if (!profile) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "User must complete onboarding first" }),
      };
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
        UpdateExpression:
          "SET safeToSpend = :s, plaidAccessToken = :pat REMOVE transactions",
        ExpressionAttributeValues: {
          ":s": safeToSpend,
          ":pat": plaidAccessToken,
        },
      })
      .promise();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(safeToSpend),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
