const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const secretsManager = new AWS.SecretsManager();

const USERS_TABLE = "MoniumUsers";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const PLAID_API_URL = "https://sandbox.plaid.com";

async function getSecrets() {
  try {
    const openaiSecret = await secretsManager
      .getSecretValue({
        SecretId: "monium/openai-api-key",
      })
      .promise();

    const plaidSecret = await secretsManager
      .getSecretValue({
        SecretId: "monium/plaid-secret",
      })
      .promise();

    return {
      openaiKey: openaiSecret.SecretString,
      plaidSecret: JSON.parse(plaidSecret.SecretString).secret,
    };
  } catch (error) {
    console.error("Failed to fetch secrets:", error);
    throw error;
  }
}

// Categorize a single transaction using ChatGPT
async function categorizeTransaction(transaction, openaiKey) {
  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Categorize this transaction in exactly one word: "${transaction.name}" (Amount: $${Math.abs(transaction.amount)}). Only respond with one of these categories: Bill, Subscription, Entertainment, Food, Transport, Healthcare, Shopping, Other`,
          },
        ],
        max_tokens: 10,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      console.error("OpenAI API error:", response.statusText);
      return "Other"; // Default category on error
    }

    const data = await response.json();
    const category = data.choices[0].message.content.trim();

    // Validate category
    const validCategories = [
      "Bill",
      "Subscription",
      "Entertainment",
      "Food",
      "Transport",
      "Healthcare",
      "Shopping",
      "Other",
    ];
    return validCategories.includes(category) ? category : "Other";
  } catch (error) {
    console.error("Error categorizing transaction:", error);
    return "Other";
  }
}

// Fetch transactions from Plaid
async function getPlaidTransactions(accessToken, plaidClientId, plaidSecret) {
  try {
    // Get last 90 days of transactions
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const response = await fetch(`${PLAID_API_URL}/transactions/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: accessToken,
        start_date: startDate,
        end_date: endDate,
        options: {
          count: 500,
          offset: 0,
        },
        client_id: plaidClientId,
        secret: plaidSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Plaid API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.transactions || [];
  } catch (error) {
    console.error("Error fetching Plaid transactions:", error);
    throw error;
  }
}

// Calculate safe-to-spend based on income, expenses, and goals
function calculateSafeToSpend(transactions, monthlyIncome, savingsGoal) {
  // Group transactions by category
  const categories = {
    Bill: 0,
    Subscription: 0,
    Entertainment: 0,
    Food: 0,
    Transport: 0,
    Healthcare: 0,
    Shopping: 0,
    Other: 0,
  };

  transactions.forEach((t) => {
    if (t.category && categories.hasOwnProperty(t.category)) {
      // Only count expenses (positive amounts)
      if (t.amount > 0) {
        categories[t.category] += t.amount;
      }
    }
  });

  // Calculate mandatory monthly spending (Bills + Subscriptions)
  const mandatorySpending = categories.Bill + categories.Subscription;

  // Parse savings goal
  const monthlySavings = parseFloat(savingsGoal) || 500;

  // Calculate available for discretionary spending
  const availableForSpending =
    monthlyIncome - mandatorySpending - monthlySavings;

  // Safe to spend per day
  const daysInMonth = 30;
  const safeToSpendDaily = Math.max(0, availableForSpending / daysInMonth);

  return {
    monthlyIncome: Math.round(monthlyIncome * 100) / 100,
    categoryBreakdown: categories,
    mandatorySpending: Math.round(mandatorySpending * 100) / 100,
    monthlySavings: Math.round(monthlySavings * 100) / 100,
    availableForSpending: Math.round(availableForSpending * 100) / 100,
    safeToSpendDaily: Math.round(safeToSpendDaily * 100) / 100,
    calculatedAt: new Date().toISOString(),
  };
}

exports.handler = async (event) => {
  console.log("Process Transactions Lambda invoked:", event);

  try {
    const body = JSON.parse(event.body || "{}");
    const { userId, plaidAccessToken, plaidClientId } = body;

    if (!userId || !plaidAccessToken || !plaidClientId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            "Missing required fields: userId, plaidAccessToken, plaidClientId",
        }),
      };
    }

    // Get secrets
    const secrets = await getSecrets();

    // Fetch user KYC data
    const userResult = await dynamodb
      .get({
        TableName: USERS_TABLE,
        Key: { userId },
      })
      .promise();

    if (!userResult.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "User not found" }),
      };
    }

    const user = userResult.Item;
    if (!user.kyc) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "User must complete KYC first" }),
      };
    }

    // Fetch transactions from Plaid
    const transactions = await getPlaidTransactions(
      plaidAccessToken,
      plaidClientId,
      secrets.plaidSecret,
    );

    // Categorize each transaction
    console.log(`Categorizing ${transactions.length} transactions...`);
    const categorizedTransactions = await Promise.all(
      transactions.map(async (t) => ({
        ...t,
        category: await categorizeTransaction(t, secrets.openaiKey),
      })),
    );

    // Calculate safe to spend
    const safeToSpend = calculateSafeToSpend(
      categorizedTransactions,
      user.kyc.income,
      user.kyc.goal,
    );

    // Store results in DynamoDB
    await dynamodb
      .update({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression:
          "SET transactions = :t, safeToSpend = :s, plaidAccessToken = :pat",
        ExpressionAttributeValues: {
          ":t": categorizedTransactions.slice(0, 100), // Store last 100 for DynamoDB limits
          ":s": safeToSpend,
          ":pat": plaidAccessToken,
        },
      })
      .promise();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(safeToSpend),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
