const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const USERS_TABLE = 'MoniumUsers';

exports.handler = async (event) => {
  console.log('KYC Lambda invoked:', event);

  try {
    const body = JSON.parse(event.body || '{}');
    const { userId, name, age, income, jobTitle, goal } = body;

    if (!userId || !name || !age || !income || !jobTitle || !goal) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Validate income is a number
    const numIncome = parseFloat(income);
    if (isNaN(numIncome)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Income must be a valid number' })
      };
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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'KYC data saved' })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
