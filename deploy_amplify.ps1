$ErrorActionPreference = "Stop"

# Configuration
$AWS_REGION = "us-east-1"
$STACK_NAME = "Brainwasher3-Stack"
$APP_NAME = "Brainwasher3-Frontend"
$REPO_URL = "https://github.com/maniksejwal/Brainwasher"
$BRANCH_NAME = "research"
$ProjectName = "yourbhai"
$EnvironmentName = "research"

# 1. Get Backend Outputs (for Env Vars)
Write-Host "Fetching backend configuration..."
try {
    $outputs = aws cloudformation describe-stacks --stack-name $STACK_NAME --region $AWS_REGION --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
    $albDns = ($outputs | Where-Object { $_.OutputKey -eq "LoadBalancerDNS" }).OutputValue
    $userPoolId = ($outputs | Where-Object { $_.OutputKey -eq "UserPoolId" }).OutputValue
    $clientId = ($outputs | Where-Object { $_.OutputKey -eq "UserPoolClientId" }).OutputValue
} catch {
    Write-Error "Failed to get stack outputs. Ensure backend is deployed first."
}

Write-Host "Backend API: $albDns"
Write-Host "Cognito Pool: $userPoolId"

# 2. Prompt for GitHub Token (Securely)
$ghToken = Read-Host -Prompt "Enter GitHub Personal Access Token (for Amplify connection)" -AsSecureString
$ghTokenPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($ghToken))

# 3. Create Amplify App
Write-Host "Creating Amplify App..."
$appId = aws amplify create-app `
    --name $APP_NAME `
    --repository $REPO_URL `
    --access-token $ghTokenPlain `
    --build-spec file://amplify.yml `
    --environment-variables "API_URL=http://$albDns,COGNITO_POOL_ID=$userPoolId,COGNITO_CLIENT_ID=$clientId" `
    --tags "Environment=$EnvironmentName,project=$ProjectName" `
    --region $AWS_REGION `
    --query "app.appId" --output text

if (-not $appId) {
    Write-Error "Failed to create Amplify App."
}

Write-Host "Amplify App Created: $appId"

# 4. Connect Branch
Write-Host "Connecting Branch '$BRANCH_NAME'..."
aws amplify create-branch `
    --app-id $appId `
    --branch-name $BRANCH_NAME `
    --enable-auto-build `
    --stage PRODUCTION `
    --region $AWS_REGION

# 5. Start Deployment
Write-Host "Starting Initial Job..."
aws amplify start-job `
    --app-id $appId `
    --branch-name $BRANCH_NAME `
    --job-type RELEASE `
    --region $AWS_REGION

Write-Host "Deployment started! Check the AWS Console: https://console.aws.amazon.com/amplify/home?region=$AWS_REGION#/$appId"
