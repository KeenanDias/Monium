const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const USERS_TABLE = 'MoniumUsers';
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

exports.handler = async (event) => {
  console.log('KYC Lambda invoked:', event);

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
