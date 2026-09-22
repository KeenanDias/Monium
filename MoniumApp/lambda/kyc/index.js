const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const USERS_TABLE = 'MoniumUsers';
// Origins allowed to call this API. Cloudflare preview deploys and local dev
// servers need to work alongside production, so the caller's origin is matched
// per request and echoed back - a browser rejects a wildcard as soon as the
// request carries an Authorization header.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://monium.ca,https://www.monium.ca')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  // Cloudflare serves each deployment at <hash>.<project>.pages.dev, so allow
  // any depth of subdomain rather than a single label
  /^https:\/\/([a-z0-9-]+\.)+pages\.dev$/,
  // Workers are served from <name>.<account>.workers.dev
  /^https:\/\/([a-z0-9-]+\.)+workers\.dev$/
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
let HEADERS = { 'Content-Type': 'application/json' };

const respond = (statusCode, body) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body)
});

// Pins this request's CORS headers and answers the preflight, which lets one
// integration serve both OPTIONS and POST instead of a separate mock method.
function beginRequest(event) {
  HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin(event),
    Vary: 'Origin'
  };

  if (event && event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...HEADERS,
        'Access-Control-Allow-Methods': 'OPTIONS,POST',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  return null;
}

exports.handler = async (event) => {
  // Don't log the event - its body carries the user's income and profile data
  console.log('Profile Lambda invoked');

  const preflight = beginRequest(event);
  if (preflight) return preflight;

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      userId,
      name,
      monthlyIncome,
      incomePeriod,
      goalLabel,
      goalAmount,
      goalTargetDate
    } = body;

    if (!userId) {
      return respond(400, { error: 'Missing required field: userId' });
    }

    // Strips "$" and thousands separators, so "$5,000" doesn't become NaN and
    // then silently zero
    const parseMoney = (v) => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
      return isNaN(n) ? undefined : n;
    };

    // Income is the one figure nothing else can supply when Plaid finds no
    // recurring deposits, so it's the only required answer.
    const income = parseMoney(monthlyIncome);
    if (income === undefined || income < 0) {
      return respond(400, { error: 'Enter your take-home pay as a number' });
    }

    const profile = {
      name: name || undefined,
      // Stored monthly regardless of how it was entered, so every reader can
      // assume one unit
      monthlyIncome: incomePeriod === 'annual' ? income / 12 : income,
      incomePeriod: 'monthly',
      goalLabel: goalLabel || undefined,
      goalAmount: parseMoney(goalAmount),
      goalTargetDate: goalTargetDate || undefined,
      updatedAt: new Date().toISOString()
    };

    // DynamoDB rejects undefined attribute values outright
    Object.keys(profile).forEach((k) => {
      if (profile[k] === undefined) delete profile[k];
    });

    await dynamodb.update({
      TableName: USERS_TABLE,
      Key: { userId },
      // #p via ExpressionAttributeNames in case "profile" is ever treated as a
      // reserved word
      UpdateExpression: 'SET #p = :profile, profileComplete = :true',
      ExpressionAttributeNames: { '#p': 'profile' },
      ExpressionAttributeValues: {
        ':profile': profile,
        ':true': true
      }
    }).promise();

    return respond(200, { success: true, message: 'Profile saved' });
  } catch (error) {
    console.error('Error:', error);
    return respond(500, { error: error.message });
  }
};
