const AWS = require('aws-sdk');

const secretsManager = new AWS.SecretsManager();

// Plaid API endpoint
const PLAID_API_URL = process.env.PLAID_API_URL || 'https://sandbox.plaid.com';
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

async function getPlaidCredentials() {
  try {
    const secret = await secretsManager.getSecretValue({
      SecretId: 'monium/plaid-secret'
    }).promise();
    
    const credentials = JSON.parse(secret.SecretString);
    const clientId = credentials.client_id || process.env.PLAID_CLIENT_ID;

    if (!clientId || !credentials.secret) {
      throw new Error('monium/plaid-secret must contain client_id and secret');
    }

    return { clientId, secret: credentials.secret };
  } catch (error) {
    console.error('Failed to fetch Plaid credentials:', error);
    throw new Error('Failed to get Plaid credentials');
  }
}

exports.handler = async (event) => {
  console.log('Plaid Link Token Lambda invoked');

  const preflight = beginRequest(event);
  if (preflight) return preflight;

  try {
    const body = JSON.parse(event.body || '{}');
    const { userId } = body;

    if (!userId) {
      return respond(400, { error: 'Missing userId' });
    }

    const credentials = await getPlaidCredentials();

    // Call Plaid API to create link token
    const response = await fetch(`${PLAID_API_URL}/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: { client_user_id: userId },
        client_name: 'Monium',
        language: 'en',
        country_codes: ['CA'],
        products: ['transactions'],
        client_id: credentials.clientId,
        secret: credentials.secret
      })
    });

    // Read the body before checking status - Plaid puts the useful diagnostic
    // in error_code/error_message, and statusText alone is just "Bad Request"
    const data = await response.json();

    if (!response.ok || data.error_code) {
      console.error('Plaid link token error:', data);
      throw new Error(
        `Plaid ${data.error_code || response.status}: ${data.error_message || response.statusText}`
      );
    }

    return respond(200, {
      link_token: data.link_token,
      expiration: data.expiration
    });
  } catch (error) {
    console.error('Error:', error);
    return respond(500, { error: error.message });
  }
};
