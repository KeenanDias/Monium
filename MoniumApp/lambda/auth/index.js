const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const USERS_TABLE = "MoniumUsers";
const BCRYPT_ROUNDS = 12;

// Fail fast at cold start rather than signing tokens with a guessable key
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is not set");
}

// Same message for every auth failure so the response can't be used to
// discover which email addresses have accounts
const INVALID_CREDENTIALS = "Invalid email or password";

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

// Generate simple JWT (production: use jwt library)
function generateToken(userId, email) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64");
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
    }),
  ).toString("base64");
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64");
  return `${header}.${payload}.${signature}`;
}

async function registerUser(email, password) {
  // Check if user already exists
  const existing = await dynamodb
    .query({
      TableName: USERS_TABLE,
      IndexName: "EmailIndex",
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": email,
      },
    })
    .promise();

  if (existing.Items.length > 0) {
    throw new Error("User already exists");
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  await dynamodb
    .put({
      TableName: USERS_TABLE,
      Item: {
        userId,
        email,
        passwordHash,
        createdAt: new Date().toISOString(),
        kycComplete: false,
        plaidAccessToken: null,
      },
    })
    .promise();

  const token = generateToken(userId, email);
  return { userId, email, token };
}

async function loginUser(email, password) {
  // Query by email GSI
  const result = await dynamodb
    .query({
      TableName: USERS_TABLE,
      IndexName: "EmailIndex",
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": email,
      },
    })
    .promise();

  if (result.Items.length === 0) {
    throw new Error(INVALID_CREDENTIALS);
  }

  const user = result.Items[0];

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new Error(INVALID_CREDENTIALS);
  }

  const token = generateToken(user.userId, user.email);
  return { userId: user.userId, email: user.email, token };
}

exports.handler = async (event) => {
  console.log("Auth Lambda invoked:", event);

  try {
    const body = JSON.parse(event.body || "{}");
    const { email, password, action } = body;

    if (!email || !password || !action) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Missing required fields: email, password, action",
        }),
      };
    }

    let result;
    if (action === "register") {
      result = await registerUser(email, password);
    } else if (action === "login") {
      result = await loginUser(email, password);
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Invalid action. Use "register" or "login"',
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
