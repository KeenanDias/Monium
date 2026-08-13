const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const secretsManager = new AWS.SecretsManager();

const USERS_TABLE = "MoniumUsers";
const PLAID_API_URL = process.env.PLAID_API_URL || "https://sandbox.plaid.com";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://monium.ca";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
};

const respond = (statusCode, body) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

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
