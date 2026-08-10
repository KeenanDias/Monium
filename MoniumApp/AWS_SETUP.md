# AWS Setup Guide - Monium iOS Backend

**Status:** Ready to execute  
**Time:** ~30 minutes  
**Region:** us-east-1

---

## STEP 1: Install AWS CLI (5 minutes)

### Windows

```powershell
# Download the installer
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri "https://awscli.amazonaws.com/AWSCLIV2.msi" -OutFile "AWSCLIV2.msi"

# Install
msiexec.exe /i AWSCLIV2.msi

# Verify installation (restart terminal after install)
aws --version
```

If the above doesn't work, download directly from: https://awscli.amazonaws.com/AWSCLIV2.msi

---

## STEP 2: Create IAM User with Programmatic Access (10 minutes)

### Via AWS Console

1. Go to **https://console.aws.amazon.com/iam/home**
2. Click **Users** in left sidebar
3. Click **Create user**
4. **User name:** `monium-dev`
5. Click **Next**
6. Attach these policies:
   - `AWSLambdaFullAccess`
   - `AmazonDynamoDBFullAccess`
   - `APIGatewayAdministrator`
   - `SecretsManagerReadWrite`
7. Click **Create user**
8. Go to user details → **Security credentials**
9. Click **Create access key** → Select `Local code`
10. **Download** the CSV file (contains Access Key ID & Secret Access Key)
11. ⚠️ **SAVE THIS SECURELY** - you'll only see it once

---

## STEP 3: Configure AWS CLI (5 minutes)

```powershell
# Run this in PowerShell/Terminal
aws configure

# When prompted:
# AWS Access Key ID: [paste from CSV]
# AWS Secret Access Key: [paste from CSV]
# Default region name: us-east-1
# Default output format: json

# Verify it worked
aws sts get-caller-identity
```

**Expected output:**

```json
{
  "UserId": "AIDAXXXXXXXXXXXXXXXX",
  "Account": "123456789012",
  "Arn": "arn:aws:iam::123456789012:user/monium-dev"
}
```

---

## STEP 4: Create DynamoDB Table (2 minutes)

```powershell
# Create the Users table
aws dynamodb create-table `
  --table-name MoniumUsers `
  --attribute-definitions `
    AttributeName=userId,AttributeType=S `
    AttributeName=email,AttributeType=S `
  --key-schema `
    AttributeName=userId,KeyType=HASH `
  --global-secondary-indexes `
    'IndexName=EmailIndex,KeySchema=[{AttributeName=email,KeyType=HASH}],Projection={ProjectionType=ALL}' `
  --billing-mode PAY_PER_REQUEST `
  --region us-east-1

# Wait for table to be created (should complete in ~30 seconds)
aws dynamodb describe-table --table-name MoniumUsers --region us-east-1

# Look for "TableStatus": "ACTIVE"
```

**Save this somewhere:** Your AWS Account ID (from the ARN above)

---

## STEP 5: Store API Keys in Secrets Manager (5 minutes)

```powershell
# Store Plaid Secret
aws secretsmanager create-secret `
  --name monium/plaid-secret `
  --secret-string "YOUR_PLAID_SECRET_KEY_HERE" `
  --region us-east-1

# Store OpenAI API Key
aws secretsmanager create-secret `
  --name monium/openai-api-key `
  --secret-string "YOUR_OPENAI_API_KEY_HERE" `
  --region us-east-1

# Verify secrets were created
aws secretsmanager list-secrets --region us-east-1
```

---

## STEP 6: Create S3 Bucket for Lambda Deployment (2 minutes)

```powershell
# Create bucket (bucket names must be globally unique)
$accountId = aws sts get-caller-identity --query Account --output text
$bucketName = "monium-lambda-$accountId"

aws s3api create-bucket `
  --bucket $bucketName `
  --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning `
  --bucket $bucketName `
  --versioning-configuration Status=Enabled
```

**Save this:** `$bucketName` - you'll need it for deploying Lambda functions

---

## STEP 7: Create IAM Role for Lambda (5 minutes)

Create a file called `lambda-trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Then run:

```powershell
# Create the role
aws iam create-role `
  --role-name MoniumLambdaRole `
  --assume-role-policy-document file://lambda-trust-policy.json

# Attach policies for Lambda to access DynamoDB, Secrets, logs
aws iam attach-role-policy `
  --role-name MoniumLambdaRole `
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam attach-role-policy `
  --role-name MoniumLambdaRole `
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess

aws iam attach-role-policy `
  --role-name MoniumLambdaRole `
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
```

---

## STEP 8: Verify Everything Works (2 minutes)

```powershell
# List your DynamoDB tables
aws dynamodb list-tables --region us-east-1

# Should show:
# "Tables": ["MoniumUsers"]

# List your secrets
aws secretsmanager list-secrets --region us-east-1

# Look for "monium/plaid-secret" and "monium/openai-api-key"

# List your S3 buckets
aws s3 ls

# Should show your "monium-lambda-XXXX" bucket
```

---

## ✅ SUCCESS CHECKLIST

- [ ] AWS CLI installed (`aws --version` works)
- [ ] IAM user created with Access Key & Secret
- [ ] `aws sts get-caller-identity` shows your user
- [ ] DynamoDB table "MoniumUsers" exists and is ACTIVE
- [ ] Secrets stored in Secrets Manager
- [ ] S3 bucket created for Lambda deployment
- [ ] Lambda IAM role created with proper permissions

---

## 📌 SAVE THESE VALUES NOW

Create a file called `.env-aws` (in your MoniumApp folder) and save:

```
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012
AWS_LAMBDA_ROLE_ARN=arn:aws:iam::123456789012:role/MoniumLambdaRole
AWS_S3_BUCKET=monium-lambda-123456789012
PLAID_SECRET=your-plaid-secret-key
OPENAI_API_KEY=your-openai-api-key
```

⚠️ **DO NOT COMMIT THIS FILE TO GIT** - it contains secrets!

---

## 🚨 TROUBLESHOOTING

| Error                    | Fix                                                                        |
| ------------------------ | -------------------------------------------------------------------------- |
| `aws: command not found` | AWS CLI not installed. Run the installer again and restart terminal.       |
| `InvalidClientTokenId`   | Access Key ID is wrong. Check your CSV file.                               |
| `ResourceInUseException` | Table/secret/bucket already exists. Delete it first or use different name. |
| `AccessDenied`           | IAM user missing permissions. Re-attach the policies (Step 7).             |

---

## NEXT STEP

Once you've completed all 8 steps, we'll create the Lambda functions and API Gateway.

Run this to confirm readiness:

```powershell
aws dynamodb scan --table-name MoniumUsers --region us-east-1 --limit 1
```

Should return: `Count: 0` (empty table is good!)
