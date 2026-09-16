#!/usr/bin/env powershell

# Monium - Enable CORS on every API Gateway resource
#
# Browsers send a preflight OPTIONS request before any cross-origin POST. Without
# a method to answer it, every call from the web app is blocked before it starts.
#
# OPTIONS is routed to the same Lambda that serves POST (AWS_PROXY) rather than a
# mock integration. A mock can only return one hardcoded origin, which would lock
# the API to production and break localhost and Cloudflare preview deploys. The
# Lambda matches the caller's Origin against its allowlist and echoes it back.
#
# The allowlist itself lives in the ALLOWED_ORIGINS environment variable, set by
# deploy-lambdas.ps1.

param(
    [string]$ApiId = "",
    [string]$Region = "us-east-1",
    [switch]$Help
)

if ($Help -or -not $ApiId) {
    Write-Host @"
USAGE:
  .\add-cors.ps1 -ApiId <rest-api-id> [-Region us-east-1]

Find the API id in api-config.json, or with:
  aws apigateway get-rest-apis --query "items[?name=='monium-api'].id" --output text
"@
    exit ($(if ($Help) { 0 } else { 1 }))
}

$ErrorActionPreference = "Stop"

$AccountId = aws sts get-caller-identity --query Account --output text
if ($LASTEXITCODE -ne 0) { throw "Could not resolve AWS account id" }

# Which Lambda backs each route
$RouteLambda = @{
    "/auth"                 = "monium-auth"
    "/kyc"                  = "monium-kyc"
    "/plaid"                = "monium-plaid-link-token"
    "/plaid-exchange"       = "monium-plaid-exchange"
    "/process-transactions" = "monium-process-transactions"
}

Write-Host "Enabling CORS on API $ApiId" -ForegroundColor Cyan

$resources = aws apigateway get-resources --rest-api-id $ApiId --region $Region | ConvertFrom-Json

foreach ($r in $resources.items) {
    if (-not $r.pathPart) { continue }  # skip the root resource

    $fn = $RouteLambda[$r.path]
    if (-not $fn) {
        Write-Host "  - $($r.path) (no Lambda mapped, skipping)" -ForegroundColor Yellow
        continue
    }

    Write-Host "  - $($r.path) -> $fn"

    # Remove any previous OPTIONS method so a leftover mock integration and its
    # response mappings can't shadow the proxy integration below.
    $ErrorActionPreference = "Continue"
    aws apigateway delete-method `
        --rest-api-id $ApiId --resource-id $r.id `
        --http-method OPTIONS --region $Region 2>$null | Out-Null
    $ErrorActionPreference = "Stop"

    aws apigateway put-method `
        --rest-api-id $ApiId --resource-id $r.id `
        --http-method OPTIONS --authorization-type NONE `
        --region $Region | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "put-method OPTIONS failed for $($r.path)" }

    $lambdaArn = "arn:aws:lambda:${Region}:${AccountId}:function:${fn}"
    $uri = "arn:aws:apigateway:${Region}:lambda:path/2015-03-31/functions/${lambdaArn}/invocations"

    aws apigateway put-integration `
        --rest-api-id $ApiId --resource-id $r.id `
        --http-method OPTIONS --type AWS_PROXY `
        --integration-http-method POST --uri $uri `
        --region $Region | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "put-integration OPTIONS failed for $($r.path)" }

    # Let API Gateway invoke the function for OPTIONS as well as POST.
    # A ConflictException just means the statement already exists.
    $ErrorActionPreference = "Continue"
    aws lambda add-permission `
        --function-name $fn `
        --statement-id "$fn-apigw-options" `
        --action lambda:InvokeFunction `
        --principal apigateway.amazonaws.com `
        --source-arn "arn:aws:execute-api:${Region}:${AccountId}:${ApiId}/*/OPTIONS/*" `
        --region $Region 2>$null | Out-Null
    $ErrorActionPreference = "Stop"
}

Write-Host "Deploying to prod stage..." -ForegroundColor Cyan
aws apigateway create-deployment --rest-api-id $ApiId --stage-name prod --region $Region | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Deployment failed" }

Write-Host "CORS enabled and deployed." -ForegroundColor Green
