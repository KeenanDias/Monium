const AWS = require('aws-sdk');

const secretsManager = new AWS.SecretsManager();

// Plaid API endpoint
const PLAID_API_URL = 'https://sandbox.plaid.com'; // Use sandbox for testing

async function getPlaidCredentials() {
  try {
    const secret = await secretsManager.getSecretValue({
      SecretId: 'monium/plaid-secret'
    }).promise();
    
    const credentials = JSON.parse(secret.SecretString);
    return {
      clientId: process.env.PLAID_CLIENT_ID,
      secret: credentials.secret
    };
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
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing userId' })
      };
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
        country_codes: ['US'],
        products: ['transactions'],
        client_id: credentials.clientId,
        secret: credentials.secret
      })
    });

    if (!response.ok) {
      throw new Error(`Plaid API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error_code) {
      throw new Error(`Plaid error: ${data.error_message}`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        link_token: data.link_token,
        expiration: data.expiration
      })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
