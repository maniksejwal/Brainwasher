param(
    [string]$Llama4EndpointName = $(if ($env:LLAMA4_ENDPOINT_NAME) { $env:LLAMA4_ENDPOINT_NAME } else { "emm-llama4-dev" })
)

$ErrorActionPreference = "Stop"

# Configuration
$AWS_REGION   = "ap-south-1"
$STACK_NAME   = "Brainwasher3-Stack"
$IMAGE_TAG    = "latest"
$GITHUB_REPO  = "https://github.com/maniksejwal/Brainwasher"
$GITHUB_BRANCH = "research"

# ─── Validate Required Params ──────────────────────────────────────────────────
Write-Host "  Using SageMaker Endpoint: $Llama4EndpointName (ap-south-1)"

# ─── 1. Check Requirements ─────────────────────────────────────────────────────
Write-Host "`n[1/7] Checking AWS CLI & Docker..."
aws --version
docker --version

# ─── 2. Deploy CloudFormation ──────────────────────────────────────────────────
Write-Host "`n[2/7] Deploying Infrastructure (CloudFormation)..."
aws cloudformation deploy `
  --template-file infrastructure.yaml `
  --stack-name $STACK_NAME `
  --capabilities CAPABILITY_NAMED_IAM `
  --region $AWS_REGION `
  --parameter-overrides `
    EnvironmentName=research `
    ProjectName=yourbhai `
    Llama4EndpointName="$Llama4EndpointName" `
  --no-fail-on-empty-changeset

# ─── 3. Get Stack Outputs ──────────────────────────────────────────────────────
Write-Host "`n[3/7] Retrieving Stack Outputs..."
$outputs    = aws cloudformation describe-stacks --stack-name $STACK_NAME --region $AWS_REGION --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
$ecrRepoUri = ($outputs | Where-Object { $_.OutputKey -eq "ECRRepoUri" }).OutputValue
$albDns     = ($outputs | Where-Object { $_.OutputKey -eq "LoadBalancerDNS" }).OutputValue
$cognitoPool   = ($outputs | Where-Object { $_.OutputKey -eq "CognitoUserPoolId" }).OutputValue
$cognitoClient = ($outputs | Where-Object { $_.OutputKey -eq "CognitoClientId" }).OutputValue

Write-Host "  ECR Repo : $ecrRepoUri"
Write-Host "  ALB DNS  : $albDns"
Write-Host "  Cognito  : $cognitoPool / $cognitoClient"

# ─── 4. Login to ECR ──────────────────────────────────────────────────────────
Write-Host "`n[4/7] Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ecrRepoUri

# ─── 5. Build & Push Docker Image ─────────────────────────────────────────────
Write-Host "`n[5/7] Building & Pushing Docker Image..."
docker build -t $STACK_NAME .
docker tag "${STACK_NAME}:latest" "${ecrRepoUri}:${IMAGE_TAG}"
docker push "${ecrRepoUri}:${IMAGE_TAG}"

# ─── 6. Force ECS Deployment ──────────────────────────────────────────────────
Write-Host "`n[6/7] Updating ECS Service..."
aws ecs update-service `
  --region $AWS_REGION `
  --cluster "research-cluster" `
  --service "research-service" `
  --force-new-deployment | Out-Null

# ─── 7. Amplify Frontend Setup ────────────────────────────────────────────────
Write-Host "`n[7/7] Setting up Amplify Frontend..."

# Check if app already exists
$existingApps = aws amplify list-apps --region $AWS_REGION --query "apps[?name=='Brainwasher3-Frontend'].appId" --output json | ConvertFrom-Json
if ($existingApps.Count -gt 0) {
    $AMPLIFY_APP_ID = $existingApps[0]
    Write-Host "  Found Amplify app: $AMPLIFY_APP_ID"

    # Set environment variables on the Amplify app
    Write-Host "  Setting Amplify env vars (API_URL, Cognito)..."
    aws amplify update-app `
        --app-id $AMPLIFY_APP_ID `
        --region $AWS_REGION `
        --environment-variables "API_URL=http://$albDns,COGNITO_POOL_ID=$cognitoPool,COGNITO_CLIENT_ID=$cognitoClient" | Out-Null

    # Trigger a build
    Write-Host "  Triggering Amplify build on branch: $GITHUB_BRANCH..."
    aws amplify start-job `
        --app-id $AMPLIFY_APP_ID `
        --region $AWS_REGION `
        --branch-name $GITHUB_BRANCH `
        --job-type RELEASE | Out-Null
} else {
    Write-Host "  No Amplify app found. Create it manually in the AWS Console"
    Write-Host "  then re-run this script to auto-set API_URL."
    Write-Host "  Create URL: https://ap-south-1.console.aws.amazon.com/amplify/create"
}

# ─── Summary ──────────────────────────────────────────────────────────────────
Write-Host "`n=== DEPLOYMENT COMPLETE ==="
Write-Host "  Backend  : http://$albDns"
Write-Host "  Amplify  : https://$GITHUB_BRANCH.$AMPLIFY_APP_ID.amplifyapp.com"
Write-Host "  CLI Test : `$env:ORCHESTRATOR_URL='http://$albDns'; node cli/chat/main.js"
Write-Host "=========================="

# Also write a local env.js for local testing
$configContent = @"
window.ENV_API_URL = 'http://$albDns';
window.ENV_COGNITO_POOL_ID = '$cognitoPool';
window.ENV_COGNITO_CLIENT_ID = '$cognitoClient';
"@
Set-Content -Path "gui/env.js" -Value $configContent
Write-Host "`n  gui/env.js written for local testing."
