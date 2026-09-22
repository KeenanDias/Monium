const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const USERS_TABLE = "MoniumUsers";
const BCRYPT_ROUNDS = 12;
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
  // Workers are served from <name>.<account>.workers.dev
  /^https:\/\/([a-z0-9-]+\.)+workers\.dev$/,
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
  // Never log the event itself here - its body carries a plaintext password
  console.log("Auth Lambda invoked");

  const preflight = beginRequest(event);
  if (preflight) return preflight;

  try {
    const body = JSON.parse(event.body || "{}");
    const { email, password, action } = body;

    if (!email || !password || !action) {
      return respond(400, {
        error: "Missing required fields: email, password, action",
      });
    }

    let result;
    if (action === "register") {
      result = await registerUser(email, password);
    } else if (action === "login") {
      result = await loginUser(email, password);
    } else {
      return respond(400, { error: 'Invalid action. Use "register" or "login"' });
    }

    return respond(200, result);
  } catch (error) {
    console.error("Error:", error);
    return respond(400, { error: error.message });
  }
};
