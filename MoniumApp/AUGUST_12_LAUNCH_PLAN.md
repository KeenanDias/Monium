# Monium iOS App - August 12 Launch Plan

**Timeline:** August 9-12, 2026 (3 days)  
**Goal:** Working iOS app on your iPhone  
**Status:** 🚀 READY TO START

---

## 📋 EXECUTIVE SUMMARY

### MVP Scope (Aug 12 Deliverable)

✅ **MUST HAVE:**

- User account creation & login
- KYC onboarding (name, age, income, goal, job title)
- Plaid authentication (live bank data)
- Spending categorization (via ChatGPT Mini API)
- Safe-to-spend calculation (daily budget)
- Dashboard showing safe-to-spend amount
- Local persistence between app sessions

⚠️ **NICE-TO-HAVE (Phase 2 after Aug 12):**

- Save password feature
- PDF bank statement upload path
- Transaction history UI
- Spending trends/charts
- App Store submission

---

## 🏗️ ARCHITECTURE OVERVIEW

```
┌─────────────────┐
│   iOS App       │
│   (SwiftUI)     │
└────────┬────────┘
         │ (REST API)
         ↓
┌─────────────────────────────────────┐
│   AWS Backend Stack                 │
├─────────────────────────────────────┤
│ • API Gateway (REST endpoints)      │
│ • Lambda (Functions)                │
│ • DynamoDB (User data)              │
│ • Secrets Manager (API keys)        │
└─────────────────────────────────────┘
         │
    ┌────┴────┬──────────┐
    ↓         ↓          ↓
┌────────┐ ┌─────────┐ ┌──────────┐
│ Plaid  │ │ ChatGPT │ │ Firebase │
│        │ │ Mini    │ │ (optional)
└────────┘ └─────────┘ └──────────┘
```

---

## 📅 TIMELINE BREAKDOWN

### **DAY 1 (Aug 9) - Monday: Foundation & Setup**

- ⏱️ **Morning (3 hours)**
  1. Set up AWS Lambda + DynamoDB + API Gateway
  2. Create IAM role and secrets for Plaid/ChatGPT keys
  3. Test basic Lambda function
  4. Deploy simple `/health` endpoint

- ⏱️ **Afternoon (3 hours)** 5. Create Xcode project (SwiftUI) 6. Add dependencies: Plaid SDK, AWS SDK 7. Build authentication layer (email/password with AWS Cognito or Lambda) 8. Test API connectivity from iOS app

**End of Day 1:** AWS backend responds to iOS app requests ✓

---

### **DAY 2 (Aug 10) - Tuesday: Core Flows**

- ⏱️ **Morning (4 hours)**
  1. Build KYC onboarding UI (SwiftUI screens)
  2. Implement form validation + API submission
  3. Build Plaid flow (open Plaid Link from iOS)
  4. Store Plaid access token in backend

- ⏱️ **Afternoon (4 hours)** 5. Create Lambda function to fetch Plaid transactions 6. Integrate ChatGPT Mini API for categorization 7. Build safe-to-spend calculation endpoint (fix math from website) 8. Test end-to-end: User → KYC → Plaid → Categorization → Calculation

**End of Day 2:** Full user flow works (may be buggy) ✓

---

### **DAY 3 (Aug 11-12) - Wednesday-Thursday: Polish & Debug**

- ⏱️ **All day**
  1. Build dashboard UI showing safe-to-spend number
  2. Add local caching (UserDefaults) so app works offline
  3. Extensive testing on your iPhone
  4. Fix bugs & edge cases
  5. Handle errors gracefully
  6. Test Plaid reconnection flow

**End of Day 3:** Polished working app on your iPhone ✓

---

## 🔧 SETUP & IMPLEMENTATION GUIDE

### PART 1: AWS BACKEND SETUP (Day 1 Morning - 3 hours)

#### Step 1.1: Create AWS Account & Services

```bash
# Prerequisites:
# - AWS Account (free tier works)
# - AWS CLI installed

# Set region
export AWS_REGION=us-east-1

# Create DynamoDB table for users
aws dynamodb create-table \
  --table-name MoniumUsers \
  --attribute-definitions \
    AttributeName=userId,AttributeType=S \
    AttributeName=email,AttributeType=S \
  --key-schema \
    AttributeName=userId,KeyType=HASH \
    AttributeName=email,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

#### Step 1.2: Store API Keys in Secrets Manager

```bash
# Store Plaid secret key
aws secretsmanager create-secret \
  --name monium/plaid-secret \
  --secret-string "your-plaid-secret-key"

# Store OpenAI API key
aws secretsmanager create-secret \
  --name monium/openai-key \
  --secret-string "your-openai-api-key"
```

#### Step 1.3: Create Lambda Functions

Create a `lambda` folder with these functions:

**`lambda/auth.js`** - User registration/login

```javascript
const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const crypto = require("crypto");

exports.handler = async (event) => {
  const body = JSON.parse(event.body);
  const { email, password, action } = body; // action: 'register' or 'login'

  if (action === "register") {
    const userId = crypto.randomUUID();
    const hashedPassword = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");

    await dynamodb
      .put({
        TableName: "MoniumUsers",
        Item: {
          userId,
          email,
          passwordHash: hashedPassword,
          createdAt: new Date().toISOString(),
        },
      })
      .promise();

    return {
      statusCode: 200,
      body: JSON.stringify({ userId, email }),
    };
  }

  // login logic...
};
```

**`lambda/kyc.js`** - Store KYC data

```javascript
exports.handler = async (event) => {
  const { userId, name, age, income, jobTitle, goal } = JSON.parse(event.body);

  await dynamodb
    .update({
      TableName: "MoniumUsers",
      Key: { userId },
      UpdateExpression: "SET #kycData = :data",
      ExpressionAttributeNames: { "#kycData": "kyc" },
      ExpressionAttributeValues: {
        ":data": {
          name,
          age,
          income,
          jobTitle,
          goal,
          completedAt: new Date().toISOString(),
        },
      },
    })
    .promise();

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
};
```

**`lambda/plaid-link-token.js`** - Generate Plaid Link token

```javascript
const plaid = require("plaid");

const plaidClient = new plaid.PlaidApi(
  new plaid.Configuration({
    basePath: plaid.PlaidEnvironments.sandbox,
    baseServer: new plaid.PlaidApi.ApiServer(plaid.PlaidEnvironments.sandbox),
    clientId: process.env.PLAID_CLIENT_ID,
    secret: process.env.PLAID_SECRET,
  }),
);

exports.handler = async (event) => {
  const { userId } = JSON.parse(event.body);

  const linkToken = await plaidClient.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "Monium",
    language: "en",
    countries: [{ name: "US" }],
    products: ["transactions"],
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ link_token: linkToken.link_token }),
  };
};
```

**`lambda/process-transactions.js`** - Categorize & calculate safe-to-spend

```javascript
const openai = require("openai");
const plaid = require("plaid");

const client = new openai.Client({ apiKey: process.env.OPENAI_KEY });

async function categorizTransaction(transaction) {
  const response = await client.chat.completions.create({
    model: "gpt-3.5-mini",
    messages: [
      {
        role: "user",
        content: `Categorize this transaction: "${transaction.name}" (${transaction.amount}). 
               Categories: Bill (rent/utilities/insurance), Subscription, Entertainment, Food, Transport, Other.
               Respond with only the category name.`,
      },
    ],
  });

  return response.choices[0].message.content.trim();
}

function calculateSafeToSpend(transactions, userIncome, userGoal) {
  // Fix from website: properly categorize and subtract mandatory spending
  const monthlyIncome = userIncome; // from KYC

  // Group transactions by category
  const categories = {};
  transactions.forEach((t) => {
    const cat = t.category;
    categories[cat] = (categories[cat] || 0) + t.amount;
  });

  // Calculate mandatory spending (average monthly)
  const mandatorySpending =
    (categories["Bill"] || 0) + (categories["Subscription"] || 0);

  // Calculate goal savings
  const monthlySavings = userGoal.splitMonthly || userGoal.targetAmount / 12;

  // Safe to spend per day
  const daysInMonth = 30;
  const availableForSpending =
    monthlyIncome - mandatorySpending - monthlySavings;
  const safeToSpendDaily = Math.max(0, availableForSpending / daysInMonth);

  return {
    monthlyIncome,
    mandatorySpending,
    monthlySavings,
    availableForSpending,
    safeToSpendDaily: Math.round(safeToSpendDaily * 100) / 100,
  };
}

exports.handler = async (event) => {
  const { userId, plaidAccessToken, income, goal } = JSON.parse(event.body);

  // Fetch transactions from Plaid
  const transactions = await plaidClient.transactionsGet({
    access_token: plaidAccessToken,
    start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // Last 90 days
    end_date: new Date(),
  });

  // Categorize each transaction
  const categorized = await Promise.all(
    transactions.transactions.map(async (t) => ({
      ...t,
      category: await categorizTransaction(t),
    })),
  );

  // Calculate safe to spend
  const safeToSpend = calculateSafeToSpend(categorized, income, goal);

  // Store results
  await dynamodb
    .update({
      TableName: "MoniumUsers",
      Key: { userId },
      UpdateExpression: "SET transactions = :t, safToSpend = :s",
      ExpressionAttributeValues: {
        ":t": categorized,
        ":s": safeToSpend,
      },
    })
    .promise();

  return {
    statusCode: 200,
    body: JSON.stringify(safeToSpend),
  };
};
```

#### Step 1.4: Deploy Lambda Functions

```bash
# Package and deploy
sam package --template-file template.yaml --s3-bucket your-bucket --output-template-file packaged.yaml
sam deploy --template-file packaged.yaml --stack-name monium-stack --capabilities CAPABILITY_IAM
```

---

### PART 2: iOS APP SETUP (Day 1 Afternoon - 3 hours)

#### Step 2.1: Create Xcode Project

```bash
cd /Users/YOUR_USERNAME/Desktop/funsies/monium/MoniumApp

# Create new SwiftUI project
xcode -create-project MoniumApp --type "iOS App" --language "Swift"
```

#### Step 2.2: Add Dependencies (SPM)

In Xcode, go to **File → Add Packages** and add:

- `PlaidLink-iOS`: Plaid SDK
- `aws-sdk-swift`: AWS SDK

Or via `Package.swift`:

```swift
dependencies: [
  .package(url: "https://github.com/plaid/plaid-link-ios.git", from: "4.0.0"),
  .package(url: "https://github.com/aws-amplify/aws-sdk-swift.git", from: "0.1.0")
]
```

#### Step 2.3: Core App Structure

```
MoniumApp/
├── App.swift (main entry point)
├── Models/
│   ├── User.swift
│   ├── KYCData.swift
│   └── SafeToSpend.swift
├── Services/
│   ├── APIService.swift (for backend calls)
│   ├── PlaidService.swift
│   └── KeychainService.swift (save tokens securely)
├── Views/
│   ├── AuthView.swift (login/register)
│   ├── KYCView.swift (onboarding)
│   ├── PlaidView.swift (Plaid Link)
│   └── DashboardView.swift (safe-to-spend display)
└── Assets/
    └── Localization
```

#### Step 2.4: Build Authentication View

```swift
// AuthView.swift
import SwiftUI

struct AuthView: View {
  @State private var email = ""
  @State private var password = ""
  @State private var isRegistering = false
  @State private var userId: String?

  var body: some View {
    VStack(spacing: 20) {
      TextField("Email", text: $email)
        .textFieldStyle(.roundedBorder)

      SecureField("Password", text: $password)
        .textFieldStyle(.roundedBorder)

      Button(isRegistering ? "Register" : "Login") {
        Task {
          userId = try await APIService.authenticate(
            email: email,
            password: password,
            action: isRegistering ? "register" : "login"
          )
        }
      }
      .buttonStyle(.borderedProminent)

      Toggle("Create new account", isOn: $isRegistering)
    }
    .padding()
    .navigationDestination(isPresented: NSBinding(get: { userId != nil }, set: { _ in })) {
      if let userId = userId {
        KYCView(userId: userId)
      }
    }
  }
}
```

#### Step 2.5: Build KYC View

```swift
// KYCView.swift
import SwiftUI

struct KYCView: View {
  let userId: String

  @State private var name = ""
  @State private var age = ""
  @State private var income = ""
  @State private var jobTitle = ""
  @State private var goal = ""
  @State private var isLoading = false

  var body: some View {
    Form {
      Section("Personal Information") {
        TextField("Full Name", text: $name)
        TextField("Age", text: $age).keyboardType(.numberPad)
        TextField("Job Title", text: $jobTitle)
      }

      Section("Financial") {
        TextField("Annual Income", text: $income).keyboardType(.decimalPad)
        TextField("Savings Goal (e.g., $5000)", text: $goal)
      }

      Button("Continue to Plaid") {
        Task {
          isLoading = true
          try await submitKYC()
        }
      }
      .disabled(isLoading)
    }
    .navigationDestination(isPresented: NSBinding(get: { isLoading && !isLoading }, set: { _ in })) {
      PlaidView(userId: userId)
    }
  }

  private func submitKYC() async throws {
    try await APIService.submitKYC(
      userId: userId,
      name: name,
      age: Int(age) ?? 0,
      income: Double(income) ?? 0,
      jobTitle: jobTitle,
      goal: goal
    )
  }
}
```

#### Step 2.6: Build Plaid Integration

```swift
// PlaidView.swift
import SwiftUI
import PlaidLink

struct PlaidView: View {
  let userId: String
  @State private var showPlaid = false
  @State private var plaidToken: String?
  @State private var safeToSpend: Double?

  var body: some View {
    VStack(spacing: 20) {
      if let safeToSpend = safeToSpend {
        DashboardView(safeToSpend: safeToSpend)
      } else {
        Text("Connect your bank account")
          .font(.headline)

        Button("Open Plaid") {
          Task {
            plaidToken = try await APIService.getPlaidLinkToken(userId: userId)
            showPlaid = true
          }
        }
        .buttonStyle(.borderedProminent)
      }
    }
    .sheet(isPresented: $showPlaid) {
      if let token = plaidToken {
        PlaidLinkViewController(
          token: token,
          onSuccess: { publicToken, metadata in
            Task {
              safeToSpend = try await APIService.processPlaidToken(
                userId: userId,
                publicToken: publicToken
              )
            }
          }
        )
      }
    }
  }
}

// Wrapper for PlaidLink UI (UIViewControllerRepresentable)
struct PlaidLinkViewController: UIViewControllerRepresentable {
  let token: String
  let onSuccess: (String, LinkSuccessMetadata) -> Void

  func makeUIViewController(context: Context) -> UIViewController {
    let configuration = LinkConfiguration(token: token)
    let viewController = PlaidLink.create(configuration)
    viewController.onSuccess = onSuccess
    return viewController
  }

  func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
```

#### Step 2.7: Build Dashboard

```swift
// DashboardView.swift
import SwiftUI

struct DashboardView: View {
  let safeToSpend: Double

  var body: some View {
    VStack(spacing: 30) {
      Text("Your Safe to Spend")
        .font(.title2)
        .foregroundColor(.gray)

      HStack(alignment: .top, spacing: 5) {
        Text("$")
          .font(.title2)
        Text(String(format: "%.2f", safeToSpend))
          .font(.system(size: 48, weight: .bold, design: .default))
      }
      .padding()
      .background(Color.blue.opacity(0.1))
      .cornerRadius(12)

      Text("You can safely spend this amount today without affecting your bills, subscriptions, or savings goals.")
        .font(.body)
        .foregroundColor(.gray)
        .multilineTextAlignment(.center)

      Spacer()
    }
    .padding()
    .navigationBarTitleDisplayMode(.inline)
  }
}
```

#### Step 2.8: API Service

```swift
// APIService.swift
import Foundation

class APIService {
  static let baseURL = "https://YOUR_API_GATEWAY_URL.execute-api.us-east-1.amazonaws.com/prod"

  static func authenticate(email: String, password: String, action: String) async throws -> String {
    let endpoint = "\(baseURL)/auth"
    let body = ["email": email, "password": password, "action": action]

    var request = URLRequest(url: URL(string: endpoint)!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)

    let (data, _) = try await URLSession.shared.data(for: request)
    let result = try JSONDecoder().decode(["userId": String].self, from: data)
    return result["userId"]!
  }

  static func submitKYC(userId: String, name: String, age: Int, income: Double, jobTitle: String, goal: String) async throws {
    // Similar pattern to authenticate...
  }

  static func getPlaidLinkToken(userId: String) async throws -> String {
    // Similar pattern...
  }

  static func processPlaidToken(userId: String, publicToken: String) async throws -> Double {
    // Similar pattern, returns safeToSpendDaily
  }
}
```

---

### PART 3: TESTING & LAUNCH (Day 2-3)

#### Step 3.1: Local Testing Checklist

- [ ] Create account (auth works)
- [ ] Complete KYC form (data saves)
- [ ] Open Plaid Link (connects bank)
- [ ] See safe-to-spend number on dashboard
- [ ] Close & reopen app (data persists)
- [ ] Test with multiple transactions in Plaid sandbox

#### Step 3.2: Run on Your iPhone

```bash
# In Xcode:
# 1. Connect iPhone via USB
# 2. Select your device in the target selector
# 3. Press Cmd + R (Run)
```

#### Step 3.3: Test Flows

1. **Happy path:** Register → KYC → Plaid → Dashboard
2. **Error handling:** Bad password, network down, Plaid declined
3. **Persistence:** Kill app, reopen, data still there

---

## ⚠️ CRITICAL DECISIONS FOR DEADLINE

### Safe-to-Spend Math (FIX from website)

Your website had errors. Use this formula:

```
Monthly Income: $5,000
Mandatory Spending (Bills + Subscriptions): $1,500
Savings Goal: $500/month
Available for Discretionary: $5,000 - $1,500 - $500 = $3,000
Daily Safe to Spend: $3,000 / 30 = $100/day
```

### What to SKIP for Aug 12 (Add Phase 2)

❌ NOT NEEDED for MVP:

- Save password feature (add later with Keychain)
- PDF bank statement upload (Plaid only for MVP)
- Transaction history view
- Charts/analytics
- App Store submission process
- Multiple user profiles

✅ Only focus on Plaid path for MVP

---

## 📱 APPLE DEVELOPER SETUP

You'll need a Certificate to run on your iPhone:

```bash
# Log in to Apple Developer
open https://developer.apple.com/account

# Steps:
# 1. Go to Certificates, Identifiers & Profiles
# 2. Create a new Bundle ID: com.monium.app
# 3. Download your developer certificate
# 4. In Xcode: Preferences → Accounts → Add your Apple ID
# 5. Select your team in project settings
# 6. Build & run on device
```

---

## 🚨 MOST CRITICAL PATH (DO THESE FIRST)

**Monday (Aug 9):**

1. Deploy AWS Lambda functions with DynamoDB ✓
2. Test `/auth` and `/kyc` endpoints from Postman ✓
3. Create Xcode project & basic nav ✓

**Tuesday (Aug 10):** 4. Wire up AuthView + APIService ✓ 5. Wire up KYC + Plaid Link ✓ 6. Get safe-to-spend calculation working ✓

**Wednesday (Aug 11):** 7. Build DashboardView ✓ 8. End-to-end test on your iPhone ✓ 9. Fix bugs ✓

**Thursday (Aug 12):** 10. Final polish & testing ✓

---

## 📞 TROUBLESHOOTING QUICK LINKS

| Problem                   | Solution                                     |
| ------------------------- | -------------------------------------------- |
| AWS Lambda not running    | Check CloudWatch logs                        |
| Plaid sandbox not working | Make sure you're using `sandbox` environment |
| Xcode build fails         | Run `pod install` or delete DerivedData      |
| App crashes on launch     | Check API endpoint URL is correct            |
| Safe to spend shows $0    | Check math in `calculateSafeToSpend()`       |

---

## 🎯 SUCCESS CRITERIA FOR AUG 12

You'll know you succeeded when:

1. ✅ You can create an account on your iPhone
2. ✅ You can complete KYC (name, income, goal)
3. ✅ You can connect a bank via Plaid
4. ✅ Dashboard shows a safe-to-spend number
5. ✅ Number changes if you update Plaid data

---

## 📞 NEXT STEPS

1. **Fork this plan:** Start with AWS setup (Day 1 morning)
2. **Get AWS credentials ready** (run `aws configure`)
3. **Ensure Plaid & OpenAI keys are ready**
4. **Create your Apple Developer account** (free)

You're ready to build! 🚀

**Questions? Let me know and I'll help you through each step.**
