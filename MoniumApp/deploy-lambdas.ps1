#!/usr/bin/env powershell

# Monium iOS App - Lambda Deployment Script
# Deploys all Lambda functions to AWS

param(
    [string]$AccountId = "",
    [string]$Region = "us-east-1",
    [string]$PlaidClientId = "",
    [switch]$Help
)

if ($Help) {
    Write-Host @"
USAGE:
  .\deploy-lambdas.ps1 -AccountId <account-id> -PlaidClientId <plaid-client-id> [-Region us-east-1]

PARAMETERS:
  -AccountId        Your AWS Account ID (find in IAM dashboard)
  -PlaidClientId    Your Plaid Client ID
  -Region           AWS Region (default: us-east-1)
  -Help             Show this message

EXAMPLE:
  .\deploy-lambdas.ps1 -AccountId 123456789012 -PlaidClientId pk_sandbox_xxxxx
"@
    exit 0
}

# Validate parameters
if (-not $AccountId -or -not $PlaidClientId) {
    Write-Host "ERROR: Missing required parameters" -ForegroundColor Red
    Write-Host "Use -Help for usage information"
    exit 1
}

$S3_BUCKET = "monium-lambda-$AccountId"
$ROLE_ARN = "arn:aws:iam::${AccountId}:role/MoniumLambdaRole"

# Pull the signing key from Secrets Manager - never hardcode it here
$JWT_SECRET = aws secretsmanager get-secret-value --secret-id monium/jwt-secret --region $Region --query SecretString --output text
if (-not $JWT_SECRET) {
    Write-Host "ERROR: Could not read monium/jwt-secret from Secrets Manager" -ForegroundColor Red
    exit 1
}

Write-Host @"
╔════════════════════════════════════════════════════════════════╗
║          Monium iOS - Lambda Deployment                        ║
╚════════════════════════════════════════════════════════════════╝

Account ID:          $AccountId
Region:              $Region
S3 Bucket:           $S3_BUCKET
Lambda Role ARN:     $ROLE_ARN
Plaid Client ID:     $PlaidClientId

"@

# Function to deploy a Lambda function
function Deploy-LambdaFunction {
    param(
        [string]$FunctionName,
        [string]$Directory
    )

    Write-Host "🚀 Deploying $FunctionName..." -ForegroundColor Cyan

    # Change to function directory
    Push-Location $Directory

    # Install dependencies
    Write-Host "  - Installing dependencies..."
    npm install 2>&1 | Out-Null

    # Create deployment package
    Write-Host "  - Creating deployment package..."
    $ZipFile = "$FunctionName.zip"
    
    if (Test-Path $ZipFile) {
        Remove-Item $ZipFile
    }

    # Create zip without node_modules (they'll be in Lambda layer)
    Compress-Archive -Path "index.js", "package.json" -DestinationPath $ZipFile -Force

    # Upload to S3
    Write-Host "  - Uploading to S3..."
    aws s3 cp $ZipFile "s3://$S3_BUCKET/$ZipFile" --region $Region 2>&1 | Out-Null

    # Create or update Lambda function
    $FunctionExists = aws lambda get-function --function-name $FunctionName --region $Region 2>&1 | Select-String "error" -Quiet

    if (-not $FunctionExists) {
        Write-Host "  - Updating Lambda function..."
        
        # Update code
        aws lambda update-function-code `
            --function-name $FunctionName `
            --s3-bucket $S3_BUCKET `
            --s3-key $ZipFile `
            --region $Region 2>&1 | Out-Null
        
        # Wait for update to complete
        Start-Sleep -Seconds 5
    } else {
        Write-Host "  - Creating Lambda function (first time)..."
        
        aws lambda create-function `
            --function-name $FunctionName `
            --runtime nodejs18.x `
            --role $ROLE_ARN `
            --handler "index.handler" `
            --s3-bucket $S3_BUCKET `
            --s3-key $ZipFile `
            --timeout 30 `
            --memory-size 256 `
            --environment "Variables={PLAID_CLIENT_ID=$PlaidClientId,JWT_SECRET=$JWT_SECRET}" `
            --region $Region 2>&1 | Out-Null
    }

    # update-function-code does not touch configuration, so set env vars either way
    aws lambda update-function-configuration `
        --function-name $FunctionName `
        --environment "Variables={PLAID_CLIENT_ID=$PlaidClientId,JWT_SECRET=$JWT_SECRET}" `
        --region $Region 2>&1 | Out-Null

    # Clean up
    Remove-Item $ZipFile
    Pop-Location

    Write-Host "  ✅ $FunctionName deployed!" -ForegroundColor Green
}

# Deploy each Lambda function
$Functions = @(
    @{
        Name = "monium-auth"
        Path = "./auth"
    },
    @{
        Name = "monium-kyc"
        Path = "./kyc"
    },
    @{
        Name = "monium-plaid-link-token"
        Path = "./plaid"
    },
    @{
        Name = "monium-process-transactions"
        Path = "./process-transactions"
    }
)

foreach ($func in $Functions) {
    Deploy-LambdaFunction -FunctionName $func.Name -Directory $func.Path
}

Write-Host @"

╔════════════════════════════════════════════════════════════════╗
║ ✅ Lambda Functions Deployed Successfully!                    ║
╚════════════════════════════════════════════════════════════════╝

Next Steps:
1. Create API Gateway endpoints in create-api-gateway.ps1
2. Update your iOS app with the API Gateway URL
3. Test the flows end-to-end

Lambda Functions Created:
  • monium-auth                  (registration & login)
  • monium-kyc                   (store KYC data)
  • monium-plaid-link-token      (generate Plaid link token)
  • monium-process-transactions  (categorize & calculate safe-to-spend)

View Lambda in AWS Console:
  https://console.aws.amazon.com/lambda/home?region=$Region
"@
