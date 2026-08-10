# Monium iOS App - Complete Setup Guide

🎯 **Goal:** Working iOS app on your iPhone by August 12, 2026

⏰ **Total Time:** ~8 hours (spread across 3 days)

---

## 📚 ROADMAP

```
DAY 1 (TODAY - Aug 9)
├── 1️⃣ AWS Foundation Setup (2 hours)
│   ├── Install AWS CLI
│   ├── Create DynamoDB table
│   ├── Store API keys
│   └── Deploy Lambda functions
├── 2️⃣ iOS Project Bootstrap (1 hour)
│   ├── Create Xcode project
│   ├── Add dependencies
│   └── Create folder structure
└── ⏱️ Total: 3 hours

DAY 2 (Aug 10)
├── 3️⃣ Build Authentication Flow (2 hours)
├── 4️⃣ Build KYC Onboarding (2 hours)
└── ⏱️ Total: 4 hours

DAY 3 (Aug 11-12)
├── 5️⃣ Plaid Integration (2 hours)
├── 6️⃣ Dashboard & Display (1 hour)
└── 7️⃣ Test on iPhone & Polish (2 hours)
```

---

## 🚀 START HERE

### TODAY (August 9) - Foundation Setup

**Follow these steps IN ORDER:**

#### 1. AWS Backend Setup (2 hours)

👉 **Start with:** [AWS_SETUP.md](AWS_SETUP.md)

This will:

- [ ] Install AWS CLI
- [ ] Create IAM user
- [ ] Configure credentials
- [ ] Create DynamoDB table
- [ ] Store API keys (Plaid, OpenAI)

**Check when done:**

```powershell
aws sts get-caller-identity
# Should show your AWS account
```

---

#### 2. Deploy Lambda Functions (30 min)

👉 **Start with:** [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)

Run this command (replace with your actual Account ID & Plaid key):

```powershell
cd c:\Users\diask\Desktop\funsies\monium\MoniumApp
.\deploy-lambdas.ps1 -AccountId 123456789012 -PlaidClientId pk_sandbox_xxxxx
```

**Check when done:**
Go to https://console.aws.amazon.com/lambda and verify 4 functions appear:

- ✅ monium-auth
- ✅ monium-kyc
- ✅ monium-plaid-link-token
- ✅ monium-process-transactions

---

#### 3. Create API Gateway (15 min)

Continue in [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md):

```powershell
.\create-api-gateway.ps1 -AccountId 123456789012
```

**You'll get:**

```
API Gateway URL:
https://abc123def456.execute-api.us-east-1.amazonaws.com/prod
```

**Save this URL!** ⭐ You need it for the iOS app.

---

#### 4. Bootstrap iOS Project (1 hour)

👉 **Start with:** [CREATE_XCODE_PROJECT.md](CREATE_XCODE_PROJECT.md)

This will:

- [ ] Create Xcode project
- [ ] Add package dependencies (Plaid, AWS SDK)
- [ ] Create folder structure
- [ ] Create core models & services
- [ ] Update Constants with your API URL

---

## 📝 FILES IN THIS PROJECT

| File                                                 | Purpose                              |
| ---------------------------------------------------- | ------------------------------------ |
| [AUGUST_12_LAUNCH_PLAN.md](AUGUST_12_LAUNCH_PLAN.md) | High-level 3-day plan                |
| [AWS_SETUP.md](AWS_SETUP.md)                         | AWS infrastructure setup (detailed)  |
| [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)                   | Lambda & API Gateway deployment      |
| [CREATE_XCODE_PROJECT.md](CREATE_XCODE_PROJECT.md)   | iOS project bootstrap                |
| [deploy-lambdas.ps1](deploy-lambdas.ps1)             | Script to deploy Lambda functions    |
| [create-api-gateway.ps1](create-api-gateway.ps1)     | Script to create API Gateway         |
| `lambda/`                                            | Lambda function source code          |
| `MoniumApp.xcodeproj/`                               | (Created after Step 4) Xcode project |

---

## 🔄 AFTER TODAY (Aug 9)

Once you complete the AWS setup and iOS bootstrap:

### Tomorrow (Aug 10)

- [ ] Build Login/Register flow
- [ ] Build KYC onboarding
- [ ] Test auth endpoints

### Aug 11-12

- [ ] Plaid integration
- [ ] Dashboard display
- [ ] End-to-end testing on iPhone
- [ ] Bug fixes & polish

---

## ✅ DAILY CHECKLIST

### TODAY (Aug 9)

- [ ] AWS CLI installed & configured
- [ ] DynamoDB table created
- [ ] Secrets stored (Plaid, OpenAI keys)
- [ ] Lambda functions deployed (4 functions)
- [ ] API Gateway created & working
- [ ] Xcode project created
- [ ] Dependencies added
- [ ] Core services implemented
- [ ] **By end of day:** iOS app can call AWS backend

### Tomorrow (Aug 10)

- [ ] AuthView (login/register) working
- [ ] KYCView (form) working
- [ ] End-to-end auth flow tested
- [ ] **By end of day:** User can register & complete KYC

### Aug 11-12

- [ ] Plaid Link integration
- [ ] Dashboard showing safe-to-spend
- [ ] **By end:** Full app working on your iPhone

---

## 📞 TROUBLESHOOTING QUICK LINKS

**AWS CLI Issues?**
→ See [AWS_SETUP.md - Troubleshooting section](AWS_SETUP.md#troubleshooting)

**Lambda Deployment Failed?**
→ See [DEPLOY_GUIDE.md - Troubleshooting section](DEPLOY_GUIDE.md#troubleshooting)

**Xcode Build Errors?**
→ See [CREATE_XCODE_PROJECT.md - Step 8](CREATE_XCODE_PROJECT.md#step-8-test-build)

**API Not Responding?**
→ Check CloudWatch logs: https://console.aws.amazon.com/logs

---

## 🎯 SUCCESS METRICS

You'll know you're on track when:

✅ **By End of Today (Aug 9):**

- AWS Lambda functions deployed & tested
- iOS project builds without errors
- APIService can reach AWS endpoint

✅ **By End of Tomorrow (Aug 10):**

- User can register & login
- User can complete KYC
- All data saves to DynamoDB

✅ **By Aug 12:**

- User connects Plaid
- Dashboard shows safe-to-spend number
- App is polished & works on physical iPhone

---

## 💡 PRO TIPS

1. **Save your API URL somewhere safe** - you'll need it throughout the project
2. **Test each piece before moving on** - don't build everything then test
3. **Use CloudWatch Logs to debug Lambda issues** - AWS Console → CloudWatch → Logs
4. **Keep AWS free tier in mind** - you have plenty of free requests/month
5. **Take breaks** - this is a marathon for 3 days, not a sprint

---

## 📌 IMPORTANT DATES

| Date   | Milestone            | Status          |
| ------ | -------------------- | --------------- |
| Aug 9  | AWS + iOS Foundation | 👈 YOU ARE HERE |
| Aug 10 | Auth & KYC Working   | 📅 NEXT         |
| Aug 11 | Plaid Integration    | 📅 THEN         |
| Aug 12 | Launch Ready!        | 🎯 GOAL         |

---

## 🆘 NEED HELP?

Each section has detailed troubleshooting guides. But general pattern:

1. Check the relevant markdown file (AWS_SETUP.md, DEPLOY_GUIDE.md, etc.)
2. Look in the "Troubleshooting" section
3. If still stuck, share the error message and I'll help debug

---

## 🎉 LET'S GO!

**Next Action:** Open [AWS_SETUP.md](AWS_SETUP.md) and follow Step 1-8

You've got this! 🚀

---

**Questions?** Ask me and I'll clarify any step.

**Ready to start?** Let me know when the AWS setup is complete, and we'll move to Lambda deployment.
