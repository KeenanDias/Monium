#!/usr/bin/env powershell

# Monium iOS App - Lambda Deployment Script
# Deploys all Lambda functions to AWS

param(
    [string]$AccountId = "",
    [string]$Region = "us-east-1",
    [string]$PlaidClientId = "",
    [string]$AllowedOrigins = "https://monium.ca,https://www.monium.ca",
    [string]$Only = "",
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

# Validate parameters. PlaidClientId is optional now that the Lambdas read it
# from the monium/plaid-secret JSON.
if (-not $AccountId) {
    Write-Host "ERROR: Missing required parameters" -ForegroundColor Red
    Write-Host "Use -Help for usage information"
    exit 1
}

# Stop on the first failure. Without this the script reports every function as
# deployed even when nothing was packaged or uploaded.
$ErrorActionPreference = "Stop"

$S3_BUCKET = "monium-lambda-$AccountId"
$ROLE_ARN = "arn:aws:iam::${AccountId}:role/MoniumLambdaRole"

# Pull the signing key from Secrets Manager - never hardcode it here
$JWT_SECRET = aws secretsmanager get-secret-value --secret-id monium/jwt-secret --region $Region --query SecretString --output text
if (-not $JWT_SECRET) {
    Write-Host "ERROR: Could not read monium/jwt-secret from Secrets Manager" -ForegroundColor Red
    exit 1
}

# Environment goes in as a JSON file, not the Variables={k=v,k=v} shorthand:
# ALLOWED_ORIGINS contains commas, and the shorthand reads a comma as the start
# of the next key.
$EnvFile = Join-Path $env:TEMP "monium-lambda-env.json"
$EnvJson = @{
    Variables = @{
        PLAID_CLIENT_ID = $PlaidClientId
        JWT_SECRET      = $JWT_SECRET
        ALLOWED_ORIGINS = $AllowedOrigins
    }
} | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText($EnvFile, $EnvJson)

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

    # Install dependencies. npm writes warnings to stderr, which PowerShell 5.1
    # turns into a terminating error under ErrorActionPreference=Stop - so relax
    # it here and judge success by the exit code instead.
    Write-Host "  - Installing dependencies..."
    $ErrorActionPreference = "Continue"
    npm install --omit=dev --no-audit --no-fund --loglevel=error | Out-Null
    $npmExit = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($npmExit -ne 0) { throw "npm install failed in $Directory" }

    # Create deployment package
    Write-Host "  - Creating deployment package..."
    $ZipFile = "$FunctionName.zip"
    
    if (Test-Path $ZipFile) {
        Remove-Item $ZipFile
    }

    # node_modules must be in the package - there is no Lambda layer, and the
    # Node 20+ runtimes no longer ship the AWS SDK
    # Use bsdtar, not Compress-Archive: PowerShell 5.1 writes zip entries with
    # backslash separators, which Lambda's Linux unzip flattens into broken
    # nested paths ("Cannot find module" at cold start).
    $Contents = @("index.js", "package.json")
    if (Test-Path "node_modules") { $Contents += "node_modules" }
    tar.exe -a -c -f $ZipFile $Contents
    if ($LASTEXITCODE -ne 0) { throw "Packaging failed for $FunctionName" }

    # Upload to S3
    Write-Host "  - Uploading to S3..."
    aws s3 cp $ZipFile "s3://$S3_BUCKET/$ZipFile" --region $Region | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "S3 upload failed for $FunctionName" }

    # Create or update Lambda function. A non-zero exit code here just means the
    # function doesn't exist yet, so don't let it terminate the script.
    $ErrorActionPreference = "Continue"
    aws lambda get-function --function-name $FunctionName --region $Region 2>$null | Out-Null
    $FunctionExists = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = "Stop"

    if ($FunctionExists) {
        Write-Host "  - Updating Lambda function..."
        
        # Update code
        aws lambda update-function-code `
            --function-name $FunctionName `
            --s3-bucket $S3_BUCKET `
            --s3-key $ZipFile `
            --region $Region | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "update-function-code failed for $FunctionName" }

        aws lambda wait function-updated-v2 --function-name $FunctionName --region $Region
    } else {
        Write-Host "  - Creating Lambda function (first time)..."
        
        aws lambda create-function `
            --function-name $FunctionName `
            --runtime nodejs22.x `
            --role $ROLE_ARN `
            --handler "index.handler" `
            --code "S3Bucket=$S3_BUCKET,S3Key=$ZipFile" `
            --timeout 30 `
            --memory-size 256 `
            --environment "file://$EnvFile" `
            --region $Region | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "create-function failed for $FunctionName" }

        aws lambda wait function-active-v2 --function-name $FunctionName --region $Region
    }

    # update-function-code does not touch configuration, so set env vars either way
    # The AWS CLI writes progress to stderr, which PowerShell 5.1 turns into a
    # terminating error under ErrorActionPreference=Stop - judge by exit code
    $ErrorActionPreference = "Continue"
    aws lambda update-function-configuration `
        --function-name $FunctionName `
        --environment "file://$EnvFile" `
        --region $Region 2>$null | Out-Null
    $configExit = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($configExit -ne 0) { throw "update-function-configuration failed for $FunctionName" }

    aws lambda wait function-updated-v2 --function-name $FunctionName --region $Region

    # Clean up
    Remove-Item $ZipFile
    Pop-Location

    Write-Host "  ✅ $FunctionName deployed!" -ForegroundColor Green
}

# Deploy each Lambda function
$Functions = @(
    @{
        Name = "monium-auth"
        Path = "$PSScriptRoot\lambda\auth"
    },
    @{
        Name = "monium-kyc"
        Path = "$PSScriptRoot\lambda\kyc"
    },
    @{
        Name = "monium-plaid-link-token"
        Path = "$PSScriptRoot\lambda\plaid"
    },
    @{
        Name = "monium-process-transactions"
        Path = "$PSScriptRoot\lambda\process-transactions"
    },
    @{
        Name = "monium-plaid-exchange"
        Path = "$PSScriptRoot\lambda\plaid-exchange"
    }
)

foreach ($func in $Functions) {
    # -Only lets you redeploy a single function instead of waiting on all five
    if ($Only -and $func.Name -notlike "*$Only*") { continue }
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
