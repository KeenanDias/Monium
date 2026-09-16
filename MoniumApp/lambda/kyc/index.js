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
  /^https:\/\/[a-z0-9-]+\.pages\.dev$/
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
    const { userId, name, age, income, jobTitle, goal } = body;

    if (!userId || !name || !age || !income || !jobTitle || !goal) {
      return respond(400, { error: 'Missing required fields' });
    }

    // Validate income is a number
    const numIncome = parseFloat(income);
    if (isNaN(numIncome)) {
      return respond(400, { error: 'Income must be a valid number' });
    }

    // Update user with KYC data
    await dynamodb.update({
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression: 'SET kyc = :kycData, kycComplete = :true',
      ExpressionAttributeValues: {
        ':kycData': {
          name,
          age: parseInt(age),
          income: numIncome,
          jobTitle,
          goal,
          completedAt: new Date().toISOString()
        },
        ':true': true
      }
    }).promise();

    return respond(200, { success: true, message: 'Profile saved' });
  } catch (error) {
    console.error('Error:', error);
    return respond(500, { error: error.message });
  }
};
