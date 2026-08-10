#!/usr/bin/env powershell

# Monium iOS App - API Gateway Setup Script
# Creates REST API endpoints for Lambda functions

param(
    [string]$AccountId = "",
    [string]$Region = "us-east-1",
    [switch]$Help
)

if ($Help) {
    Write-Host @"
USAGE:
  .\create-api-gateway.ps1 -AccountId <account-id> [-Region us-east-1]

PARAMETERS:
  -AccountId        Your AWS Account ID
  -Region           AWS Region (default: us-east-1)
  -Help             Show this message

EXAMPLE:
  .\create-api-gateway.ps1 -AccountId 123456789012
"@
    exit 0
}

if (-not $AccountId) {
    Write-Host "ERROR: Missing -AccountId parameter" -ForegroundColor Red
    exit 1
}

Write-Host @"
╔════════════════════════════════════════════════════════════════╗
║       Monium iOS - API Gateway Setup                           ║
╚════════════════════════════════════════════════════════════════╝
"@

# Create API Gateway REST API
Write-Host "📡 Creating API Gateway REST API..." -ForegroundColor Cyan

$ApiResponse = aws apigateway create-rest-api `
    --name "monium-api" `
    --description "Monium iOS financial tracking app API" `
    --endpoint-configuration types=REGIONAL `
    --region $Region | ConvertFrom-Json

$ApiId = $ApiResponse.id
Write-Host "  ✅ API created: $ApiId" -ForegroundColor Green

# Get root resource
$RootResource = aws apigateway get-resources `
    --rest-api-id $ApiId `
    --region $Region | ConvertFrom-Json | Select-Object -ExpandProperty items | Where-Object { $_.path -eq "/" }

$RootResourceId = $RootResource.id

# Create resources
$Resources = @("auth", "kyc", "plaid", "process-transactions")
$ResourceIds = @{}

foreach ($resource in $Resources) {
    Write-Host "📦 Creating resource: /$resource" -ForegroundColor Cyan
    
    $Response = aws apigateway create-resource `
        --rest-api-id $ApiId `
        --parent-id $RootResourceId `
        --path-part $resource `
        --region $Region | ConvertFrom-Json
    
    $ResourceIds[$resource] = $Response.id
    Write-Host "  ✅ Resource created: $($Response.id)" -ForegroundColor Green
}

# Function to create method for Lambda integration
function Create-LambdaMethod {
    param(
        [string]$RestApiId,
        [string]$ResourceId,
        [string]$LambdaFunctionName,
        [string]$AccountId,
        [string]$Region
    )

    $LambdaArn = "arn:aws:lambda:${Region}:${AccountId}:function:${LambdaFunctionName}"

    Write-Host "🔗 Creating POST method for $LambdaFunctionName..." -ForegroundColor Cyan

    # Create method
    aws apigateway put-method `
        --rest-api-id $RestApiId `
        --resource-id $ResourceId `
        --http-method POST `
        --authorization-type NONE `
        --region $Region 2>&1 | Out-Null

    # Create integration with Lambda
    aws apigateway put-integration `
        --rest-api-id $RestApiId `
        --resource-id $ResourceId `
        --http-method POST `
        --type AWS_PROXY `
        --integration-http-method POST `
        --uri "arn:aws:apigateway:${Region}:lambda:path/2015-03-31/functions/${LambdaArn}/invocations" `
        --region $Region 2>&1 | Out-Null

    # Grant API Gateway permission to invoke Lambda
    $StatementId = "$LambdaFunctionName-api-gateway-$(Get-Random)"
    
    aws lambda add-permission `
        --function-name $LambdaFunctionName `
        --statement-id $StatementId `
        --action lambda:InvokeFunction `
        --principal apigateway.amazonaws.com `
        --region $Region 2>&1 | Out-Null

    Write-Host "  ✅ POST method created" -ForegroundColor Green
}

# Create methods for each Lambda function
$Mappings = @(
    @{ Resource = "auth"; Lambda = "monium-auth" },
    @{ Resource = "kyc"; Lambda = "monium-kyc" },
    @{ Resource = "plaid"; Lambda = "monium-plaid-link-token" },
    @{ Resource = "process-transactions"; Lambda = "monium-process-transactions" }
)

foreach ($mapping in $Mappings) {
    Create-LambdaMethod `
        -RestApiId $ApiId `
        -ResourceId $ResourceIds[$mapping.Resource] `
        -LambdaFunctionName $mapping.Lambda `
        -AccountId $AccountId `
        -Region $Region
}

# Deploy API
Write-Host "🚀 Deploying API..." -ForegroundColor Cyan

$Deployment = aws apigateway create-deployment `
    --rest-api-id $ApiId `
    --stage-name "prod" `
    --region $Region | ConvertFrom-Json

Write-Host "  ✅ API deployed!" -ForegroundColor Green

# Get the API Gateway URL
$ApiUrl = "https://${ApiId}.execute-api.${Region}.amazonaws.com/prod"

Write-Host @"

╔════════════════════════════════════════════════════════════════╗
║ ✅ API Gateway Setup Complete!                                ║
╚════════════════════════════════════════════════════════════════╝

API Gateway URL:
  $ApiUrl

Endpoints:
  POST $ApiUrl/auth                    - Register/Login
  POST $ApiUrl/kyc                     - Submit KYC data
  POST $ApiUrl/plaid                   - Get Plaid link token
  POST $ApiUrl/process-transactions    - Process & calculate safe-to-spend

IMPORTANT: Save this URL to your iOS app's APIService.swift:
  static let baseURL = "$ApiUrl"

Next Steps:
1. Copy the API Gateway URL above
2. Open APIService.swift in your iOS project
3. Update baseURL = "$ApiUrl"
4. Build and run the iOS app
5. Test the authentication flow

"@

# Save URL to file for reference
@{
    ApiUrl = $ApiUrl
    ApiId = $ApiId
    Region = $Region
    AccountId = $AccountId
} | ConvertTo-Json | Out-File -FilePath "api-config.json" -Encoding UTF8

Write-Host "📝 API configuration saved to api-config.json"
