const AWS = require('aws-sdk');

const secretsManager = new AWS.SecretsManager();

// Plaid API endpoint
const PLAID_API_URL = process.env.PLAID_API_URL || 'https://sandbox.plaid.com';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://monium.ca';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN
};

const respond = (statusCode, body) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body)
});

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
  console.log('Plaid Link Token Lambda invoked:', event);

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
