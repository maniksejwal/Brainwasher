param(
    [string]$Llama4EndpointName = $(if ($env:LLAMA4_ENDPOINT_NAME) { $env:LLAMA4_ENDPOINT_NAME } else { "emm-llama4-dev" })
)

$ErrorActionPreference = "Stop"

# Configuration
$AWS_REGION   = "ap-south-1"
$STACK_NAME   = "Brainwasher3-Stack"
$LOCAL_IMAGE_NAME = "brainwasher3-stack"
$IMAGE_TAG    = "latest"
$GITHUB_REPO  = "https://github.com/maniksejwal/Brainwasher"
$GITHUB_BRANCH = "research"

# ─── Validate Required Params ──────────────────────────────────────────────────
Write-Host "  Using SageMaker Endpoint: $Llama4EndpointName (ap-south-1)"

# ─── 1. Check Requirements ─────────────────────────────────────────────────────
Write-Host "`n[1/7] Checking AWS CLI & Docker..."
aws --version
docker --version
docker info | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker daemon is not running (docker info failed). Start Docker Desktop (or the Docker service) and re-run deploy/deploy_aws.ps1."
    exit 1
}

# ─── 2. Deploy CloudFormation ──────────────────────────────────────────────────
Write-Host "`n[2/7] Deploying Infrastructure (CloudFormation)..."

$env:AWS_PAGER = ""
try {
    aws cloudformation describe-stacks --stack-name $STACK_NAME --region $AWS_REGION 2> $null
    if ($LASTEXITCODE -eq 0) {
        # Only start tasks if the image already exists in ECR; otherwise CF/ECS may flap on first deploy.
        aws ecr describe-images --repository-name "research-repo" --region $AWS_REGION --image-ids imageTag=$IMAGE_TAG 2> $null | Out-Null
        $desiredCount = if ($LASTEXITCODE -eq 0) { 1 } else { 0 }
    } else {
        $desiredCount = 0
    }
} catch {
    # Stack does not exist yet – start with 0 tasks so ECR can be populated first
    $desiredCount = 0
}
Write-Host "  Initial ECS Desired Count: $desiredCount (0 avoids CF failure on empty ECR)"
aws cloudformation deploy `
  --template-file deploy/infrastructure.yaml `
  --stack-name $STACK_NAME `
  --capabilities CAPABILITY_NAMED_IAM `
  --region $AWS_REGION `
  --parameter-overrides `
    EnvironmentName=research `
    ProjectName=yourbhai `
    Llama4EndpointName="$Llama4EndpointName" `
    EcsDesiredCount=$desiredCount `
  --no-fail-on-empty-changeset `
  --disable-rollback

# ─── 3. Get Stack Outputs ──────────────────────────────────────────────────────
Write-Host "`n[3/7] Retrieving Stack Outputs..."
$stackInfo = aws cloudformation describe-stacks --stack-name $STACK_NAME --region $AWS_REGION --output json | ConvertFrom-Json
$stackStatus = $stackInfo.Stacks[0].StackStatus
if ($stackStatus -notmatch "COMPLETE") {
    Write-Error "CloudFormation stack is in state '$stackStatus'. Cannot proceed. Check the AWS Console for details."
    exit 1
}
$outputs    = $stackInfo.Stacks[0].Outputs
$ecrRepoUri = ($outputs | Where-Object { $_.OutputKey -eq "ECRRepoUri" }).OutputValue
$albDns     = ($outputs | Where-Object { $_.OutputKey -eq "LoadBalancerDNS" }).OutputValue
$cognitoPool   = ($outputs | Where-Object { $_.OutputKey -eq "CognitoUserPoolId" }).OutputValue
$cognitoClient = ($outputs | Where-Object { $_.OutputKey -eq "CognitoClientId" }).OutputValue
$ecsCluster    = ($outputs | Where-Object { $_.OutputKey -eq "ECSClusterName" }).OutputValue
$ecsService    = ($outputs | Where-Object { $_.OutputKey -eq "ECSServiceName" }).OutputValue

Write-Host "  ECR Repo : $ecrRepoUri"
Write-Host "  ALB DNS  : $albDns"
Write-Host "  Cognito  : $cognitoPool / $cognitoClient"
Write-Host "  ECS      : $ecsCluster / $ecsService"

# ─── 4. Login to ECR ──────────────────────────────────────────────────────────
Write-Host "`n[4/7] Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ecrRepoUri

# ─── 5. Build & Push Docker Image ─────────────────────────────────────────────
Write-Host "`n[5/7] Building & Pushing Docker Image..."
docker build -t $LOCAL_IMAGE_NAME .
docker tag "${LOCAL_IMAGE_NAME}:latest" "${ecrRepoUri}:${IMAGE_TAG}"
docker push "${ecrRepoUri}:${IMAGE_TAG}"

# ─── 6. Update ECS Task Definition with Cognito Config & Deploy ───────────────
Write-Host "`n[6/7] Registering new Task Definition with Cognito config..."

# Get the current task definition (created by CloudFormation)
$taskDefArn = (aws ecs describe-services `
    --region $AWS_REGION `
    --cluster $ecsCluster `
    --services $ecsService `
    --query "services[0].taskDefinition" --output text)

$taskDefJson = aws ecs describe-task-definition `
    --region $AWS_REGION `
    --task-definition $taskDefArn `
    --query "taskDefinition" | ConvertFrom-Json

# Inject Cognito env vars into the container definition
$container = $taskDefJson.containerDefinitions[0]
$existingEnv = if ($container.environment) { $container.environment } else { @() }

# Remove any old Cognito vars and add fresh ones
$newEnv = $existingEnv | Where-Object { $_.name -notin @("COGNITO_USER_POOL_ID", "COGNITO_CLIENT_ID") }
$newEnv += [PSCustomObject]@{ name = "COGNITO_USER_POOL_ID"; value = $cognitoPool }
$newEnv += [PSCustomObject]@{ name = "COGNITO_CLIENT_ID";    value = $cognitoClient }
$container.environment = $newEnv

# Build the register-task-definition call
$registerParams = @{
    family               = $taskDefJson.family
    networkMode          = $taskDefJson.networkMode
    requiresCompatibilities = $taskDefJson.requiresCompatibilities
    cpu                  = $taskDefJson.cpu
    memory               = $taskDefJson.memory
    executionRoleArn     = $taskDefJson.executionRoleArn
    taskRoleArn          = $taskDefJson.taskRoleArn
    containerDefinitions = $taskDefJson.containerDefinitions
    volumes              = $taskDefJson.volumes
}
$registerJson = $registerParams | ConvertTo-Json -Depth 20 -Compress

# Write to a temp file to avoid command-line length issues
$tmpFile = [System.IO.Path]::GetTempFileName() + ".json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmpFile, $registerJson, $utf8NoBom)

$newTaskDefArn = (aws ecs register-task-definition `
    --region $AWS_REGION `
    --cli-input-json "file://$tmpFile" `
    --query "taskDefinition.taskDefinitionArn" --output text)

Remove-Item $tmpFile -ErrorAction SilentlyContinue
Write-Host "  New Task Definition: $newTaskDefArn"

Write-Host "  Updating ECS Service (DesiredCount=1)..."
aws ecs update-service `
  --region $AWS_REGION `
  --cluster $ecsCluster `
  --service $ecsService `
  --task-definition $newTaskDefArn `
  --desired-count 1 `
  --force-new-deployment | Out-Null

Write-Host "  ECS service update initiated. Tasks will start shortly."

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
