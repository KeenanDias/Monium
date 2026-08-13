#!/usr/bin/env powershell

# Monium - Enable CORS on every API Gateway resource
#
# Browsers send a preflight OPTIONS request before any cross-origin POST. Without
# a method to answer it, every call from the web app is blocked before it starts.
# This adds a MOCK-integration OPTIONS method (no Lambda invoked, no cost) that
# returns the CORS headers.
#
# The POST responses carry their own Access-Control-Allow-Origin header, set by
# each Lambda via the ALLOWED_ORIGIN environment variable.

param(
    [string]$ApiId = "",
    [string]$Region = "us-east-1",
    [string]$Origin = "https://monium.ca",
    [switch]$Help
)

if ($Help -or -not $ApiId) {
    Write-Host @"
USAGE:
  .\add-cors.ps1 -ApiId <rest-api-id> [-Region us-east-1] [-Origin https://monium.ca]

Find the API id in api-config.json, or with:
  aws apigateway get-rest-apis --query "items[?name=='monium-api'].id" --output text
"@
    exit ($(if ($Help) { 0 } else { 1 }))
}

$ErrorActionPreference = "Stop"

# API Gateway wants these as JSON documents. Passing them inline is unreliable on
# Windows - the CLI strips quotes - so write them to temp files and use file://
$tmp = Join-Path $env:TEMP "monium-cors"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$requestTemplate = '{"application/json": "{\"statusCode\": 200}"}'
$methodParams = '{"method.response.header.Access-Control-Allow-Headers": true, "method.response.header.Access-Control-Allow-Methods": true, "method.response.header.Access-Control-Allow-Origin": true}'
$integrationParams = '{"method.response.header.Access-Control-Allow-Headers": "''Content-Type,Authorization''", "method.response.header.Access-Control-Allow-Methods": "''OPTIONS,POST''", "method.response.header.Access-Control-Allow-Origin": "''' + $Origin + '''"}'

$reqFile = Join-Path $tmp "request-template.json"
$mrpFile = Join-Path $tmp "method-response-params.json"
$irpFile = Join-Path $tmp "integration-response-params.json"

[System.IO.File]::WriteAllText($reqFile, $requestTemplate)
[System.IO.File]::WriteAllText($mrpFile, $methodParams)
[System.IO.File]::WriteAllText($irpFile, $integrationParams)

Write-Host "Enabling CORS on API $ApiId for origin $Origin" -ForegroundColor Cyan

$resources = aws apigateway get-resources --rest-api-id $ApiId --region $Region | ConvertFrom-Json

foreach ($r in $resources.items) {
    if (-not $r.pathPart) { continue }  # skip the root resource

    Write-Host "  - $($r.path)"

    # These four calls are idempotent enough to re-run: a ConflictException just
    # means the method already exists, which is fine.
    $ErrorActionPreference = "Continue"

    aws apigateway put-method `
        --rest-api-id $ApiId --resource-id $r.id `
        --http-method OPTIONS --authorization-type NONE `
        --region $Region 2>$null | Out-Null

    aws apigateway put-integration `
        --rest-api-id $ApiId --resource-id $r.id `
        --http-method OPTIONS --type MOCK `
        --request-templates "file://$reqFile" `
        --region $Region 2>$null | Out-Null

    aws apigateway put-method-response `
        --rest-api-id $ApiId --resource-id $r.id `
        --http-method OPTIONS --status-code 200 `
        --response-parameters "file://$mrpFile" `
        --region $Region 2>$null | Out-Null

    aws apigateway put-integration-response `
        --rest-api-id $ApiId --resource-id $r.id `
        --http-method OPTIONS --status-code 200 `
        --response-parameters "file://$irpFile" `
        --region $Region 2>$null | Out-Null

    $ErrorActionPreference = "Stop"
}

Write-Host "Deploying to prod stage..." -ForegroundColor Cyan
aws apigateway create-deployment --rest-api-id $ApiId --stage-name prod --region $Region | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Deployment failed" }

Remove-Item -Recurse -Force $tmp

Write-Host "CORS enabled and deployed." -ForegroundColor Green
