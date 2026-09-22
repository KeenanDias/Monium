const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const secretsManager = new AWS.SecretsManager();

const USERS_TABLE = "MoniumUsers";
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

// Swap the short-lived public_token the browser received from Plaid Link for a
// long-lived access_token. The access_token is stored server-side and is never
// returned to the client - Plaid requires it stay on the backend.
exports.handler = async (event) => {
  console.log("Plaid Exchange Lambda invoked");

  const preflight = beginRequest(event);
  if (preflight) return preflight;

  try {
    const body = JSON.parse(event.body || "{}");
    const { userId, publicToken } = body;

    if (!userId || !publicToken) {
      return respond(400, {
        error: "Missing required fields: userId, publicToken",
      });
    }

    // Confirm the user exists before spending a Plaid call on them
    const userResult = await dynamodb
      .get({ TableName: USERS_TABLE, Key: { userId } })
      .promise();

    if (!userResult.Item) {
      return respond(404, { error: "User not found" });
    }

    const credentials = await getPlaidCredentials();

    const response = await fetch(`${PLAID_API_URL}/item/public_token/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_token: publicToken,
        client_id: credentials.clientId,
        secret: credentials.secret,
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error_code) {
      console.error("Plaid exchange error:", data);
      throw new Error(
        `Plaid ${data.error_code || response.status}: ${data.error_message || response.statusText}`,
      );
    }

    await dynamodb
      .update({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression:
          "SET plaidAccessToken = :t, plaidItemId = :i, plaidLinkedAt = :d",
        ExpressionAttributeValues: {
          ":t": data.access_token,
          ":i": data.item_id,
          ":d": new Date().toISOString(),
        },
      })
      .promise();

    console.log(`Linked Plaid item ${data.item_id} for user ${userId}`);

    // item_id is safe to return (it identifies the connection, not the access);
    // access_token deliberately is not
    return respond(200, { success: true, itemId: data.item_id });
  } catch (error) {
    console.error("Error:", error);
    return respond(500, { error: error.message });
  }
};
