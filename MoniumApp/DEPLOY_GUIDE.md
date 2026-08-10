# AWS Backend Setup & Deployment - Quick Guide

**Status:** Ready to execute  
**Time:** ~2 hours total  
**What you'll have:** Working AWS backend with API endpoints

---

## 📋 ONE-LINE SUMMARY

1. Install AWS CLI & configure credentials (15 min)
2. Run setup script to create DynamoDB + IAM + Secrets (20 min)
3. Deploy Lambda functions (15 min)
4. Create API Gateway endpoints (10 min)
5. Get API URL → use in iOS app (5 min)

---

## 🚀 STEP-BY-STEP EXECUTION

### STEP 1: AWS CLI Setup (First Time Only)

Follow the detailed guide in [AWS_SETUP.md](AWS_SETUP.md):
- Install AWS CLI
- Create IAM user
- Configure credentials
- Create DynamoDB table
- Store API keys in Secrets Manager

**Check:** Run this to verify setup worked:
```powershell
aws sts get-caller-identity
```

Should show your AWS account info.

---

### STEP 2: Deploy Lambda Functions

Open PowerShell and navigate to the MoniumApp folder:

```powershell
cd c:\Users\diask\Desktop\funsies\monium\MoniumApp

# Deploy Lambda functions
.\deploy-lambdas.ps1 `
  -AccountId 123456789012 `
  -PlaidClientId pk_sandbox_YOUR_KEY `
  -Region us-east-1
```

**Replace:**
- `123456789012` → Your AWS Account ID (from IAM console)
- `pk_sandbox_YOUR_KEY` → Your actual Plaid Client ID

**What it does:**
- Packages each Lambda function
- Uploads to S3
- Creates Lambda functions in AWS
- Sets environment variables

**Check:** Go to https://console.aws.amazon.com/lambda and verify 4 functions exist:
- monium-auth ✓
- monium-kyc ✓
- monium-plaid-link-token ✓
- monium-process-transactions ✓

---

### STEP 3: Create API Gateway

```powershell
.\create-api-gateway.ps1 `
  -AccountId 123456789012 `
  -Region us-east-1
```

**Output:** You'll get something like:
```
API Gateway URL:
  https://abc123def456.execute-api.us-east-1.amazonaws.com/prod
```

**Save this URL!** You'll need it for the iOS app.

**Check:** The script creates `api-config.json` with your API details.

---

### STEP 4: Update iOS App with API URL

You'll do this after you create the Xcode project, but save the URL for now!

---

## 📊 WHAT YOU NOW HAVE

```
AWS Backend:
├── DynamoDB (MoniumUsers table)
├── 4 Lambda Functions:
│   ├── monium-auth (login/register)
│   ├── monium-kyc (store profile)
│   ├── monium-plaid-link-token (Plaid integration)
│   └── monium-process-transactions (categorization & calculation)
├── API Gateway (REST endpoints)
└── Secrets Manager (stores Plaid & OpenAI keys)
```

**Total Cost:** $0-5/month (free tier) ✓

---

## ✅ VERIFICATION CHECKLIST

- [ ] AWS CLI installed (`aws --version` works)
- [ ] Credentials configured (`aws sts get-caller-identity` shows your account)
- [ ] DynamoDB table created (`aws dynamodb list-tables`)
- [ ] Secrets stored (`aws secretsmanager list-secrets`)
- [ ] Lambda functions deployed (4 functions in console)
- [ ] API Gateway created (got URL from script)
- [ ] `api-config.json` exists in MoniumApp folder

---

## 🧪 TEST THE BACKEND (Optional)

Use Postman or curl to test the `/auth` endpoint:

```bash
curl -X POST https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/auth \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpass123",
    "action": "register"
  }'
```

Should return:
```json
{
  "userId": "uuid-here",
  "email": "test@example.com",
  "token": "jwt-token-here"
}
```

---

## 🚨 TROUBLESHOOTING

| Issue | Solution |
|-------|----------|
| `aws: command not found` | AWS CLI not installed. Restart terminal after install. |
| `Deploy-LambdaFunction: The term is not recognized` | Run script from MoniumApp folder. Use full path: `.\deploy-lambdas.ps1` |
| `InvalidClientTokenId` | AWS credentials wrong. Run `aws configure` again. |
| `Function not found` | Lambda wasn't created. Check CloudWatch logs. |
| `Access Denied on S3` | IAM user needs S3 permissions. Re-attach policies. |

---

## 📚 NEXT: BOOTSTRAP iOS PROJECT

Once AWS setup is complete, move to [CREATE_XCODE_PROJECT.md](CREATE_XCODE_PROJECT.md) to build the iOS frontend.

---

## 💾 FILES CREATED

- `lambda/auth/index.js` - User authentication
- `lambda/kyc/index.js` - KYC form submission
- `lambda/plaid/index.js` - Plaid integration
- `lambda/process-transactions/index.js` - Categorization & calculation
- `deploy-lambdas.ps1` - Deploy script
- `create-api-gateway.ps1` - API Gateway setup
- `api-config.json` - API configuration (generated after deployment)

---

## 🎯 YOU ARE HERE IN THE TIMELINE

```
[AWS Setup] ← YOU ARE HERE
     ↓
[Lambda Deployment] ← NEXT (15 min)
     ↓
[API Gateway Setup] ← THEN (10 min)
     ↓
[iOS Project Bootstrap]
     ↓
[Auth Flow Implementation]
     ↓
[KYC Flow]
     ↓
[Plaid Integration]
     ↓
[Safe-to-Spend Dashboard]
     ↓
[Test on iPhone] ✅ LAUNCH READY!
```

**Time to AWS launch:** ~40 minutes  
**Time to iOS app working:** ~4 hours  
**TIME TO IPHONE:** ~6 hours total

Let me know when AWS setup is done! 🚀
