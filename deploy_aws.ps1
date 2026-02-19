$ErrorActionPreference = "Stop"

# Configuration
$AWS_REGION = "us-east-1"
$STACK_NAME = "Brainwasher3-Stack"
$ECR_REPO_NAME = "brainwasher3-repo"
$IMAGE_TAG = "latest"

# 1. Check Requirements
Write-Host "Checking AWS CLI..."
aws --version

# 2. Deploy CloudFormation (Infrastructure)
Write-Host "Deploying Infrastructure..."
aws cloudformation deploy `
  --template-file infrastructure.yaml `
  --stack-name $STACK_NAME `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides EnvironmentName=research ProjectName=yourbhai

# 3. Get Outputs
$outputs = aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
$ecrRepoUri = ($outputs | Where-Object { $_.OutputKey -eq "ECRRepoUri" }).OutputValue
$albDns = ($outputs | Where-Object { $_.OutputKey -eq "LoadBalancerDNS" }).OutputValue

Write-Host "ECR Repo: $ecrRepoUri"
Write-Host "ALB DNS: $albDns"

# 4. Login to ECR
Write-Host "Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ecrRepoUri

# 5. Build & Push Docker Image
Write-Host "Building Docker Image..."
docker build -t $STACK_NAME .
docker tag "${STACK_NAME}:latest" "${ecrRepoUri}:${IMAGE_TAG}"

Write-Host "Pushing to ECR..."
docker push "${ecrRepoUri}:${IMAGE_TAG}"

# 6. Force Deployment (Update Service)
Write-Host "Updating ECS Service..."
aws ecs update-service --cluster "${STACK_NAME}-cluster" --service "${STACK_NAME}-service" --force-new-deployment

# 7. Generate Frontend Config
Write-Host "Generating Frontend Config..."
$configContent = @"
window.ENV_API_URL = 'http://$albDns';
window.ENV_COGNITO_POOL_ID = 'PLACEHOLDER_POOL_ID'; // Retrieve from outputs if needed
window.ENV_COGNITO_CLIENT_ID = 'PLACEHOLDER_CLIENT_ID';
"@
Set-Content -Path "gui/env.js" -Value $configContent

Write-Host "Deployment Complete!"
Write-Host "Frontend Config generated at gui/env.js"
