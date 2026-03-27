<#
.SYNOPSIS
  Adds HTTPS (443) to an existing Application Load Balancer and redirects HTTP -> HTTPS.

.DESCRIPTION
  Use this when you have an ACM certificate in ap-south-1 whose DOMAIN NAME you will point
  at this ALB (CNAME or Alias). You cannot reuse a cert for "api.other-alb.com" while
  sending traffic to research-alb — the hostname must match the certificate.

  This script does NOT use CloudFormation (avoids stack drift / UPDATE_FAILED on ECSTaskDefinition).

.PARAMETER CertificateArn
  Issued ACM certificate ARN in the same region as the ALB (e.g. arn:aws:acm:ap-south-1:...).

.PARAMETER ApiBaseUrl
  After DNS is updated, set this to https://YOUR-HOSTNAME (no trailing slash) for Amplify API_URL.

.NOTES
  Required IAM: elasticloadbalancing:* (listeners), ec2:AuthorizeSecurityGroupIngress on ALB SG,
  acm:ListCertificates (read). Requesting new certs needs acm:RequestCertificate (not granted on yourbhai user in 2026-03).

.EXAMPLE
  .\deploy\enable_alb_https.ps1 -CertificateArn "arn:aws:acm:ap-south-1:ACCOUNT:certificate/..." -DryRun
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$CertificateArn,

    [string]$Region = "ap-south-1",
    [string]$LoadBalancerName = "research-alb",
    [string]$TargetGroupName = "research-tg",
    [string]$AmplifyAppId = "d1dzfg8k3u9811",
    [string]$AmplifyBranch = "research",
    [switch]$DryRun,
    [switch]$SkipAmplify
)

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

function Get-AlbArn {
    $arn = aws elbv2 describe-load-balancers --region $Region --names $LoadBalancerName --query "LoadBalancers[0].LoadBalancerArn" --output text 2>$null
    if (-not $arn -or $arn -eq "None") { throw "Load balancer '$LoadBalancerName' not found in $Region" }
    return $arn
}

$albArn = Get-AlbArn
$sgIds = aws elbv2 describe-load-balancers --region $Region --load-balancer-arns $albArn --query "LoadBalancers[0].SecurityGroups" --output json | ConvertFrom-Json

$listenerJson = aws elbv2 describe-listeners --region $Region --load-balancer-arn $albArn --output json | ConvertFrom-Json
$existing443 = $listenerJson.Listeners | Where-Object { $_.Port -eq 443 } | Select-Object -First 1
if ($existing443) {
    Write-Host "Listener on 443 already exists: $($existing443.ListenerArn) - nothing to do for HTTPS create."
    exit 0
}

$httpListener = $listenerJson.Listeners | Where-Object { $_.Port -eq 80 } | Select-Object -First 1
if (-not $httpListener) { throw "No HTTP listener on port 80" }
$httpListenerArn = $httpListener.ListenerArn

$tgArn = aws elbv2 describe-target-groups --region $Region --names $TargetGroupName --query "TargetGroups[0].TargetGroupArn" --output text
if (-not $tgArn -or $tgArn -eq "None") { throw "Target group '$TargetGroupName' not found" }

Write-Host "ALB: $albArn"
Write-Host "Certificate: $CertificateArn"
Write-Host "Target group: $tgArn"

# Open 443 on ALB security groups
foreach ($sg in $sgIds) {
    $sgDetail = aws ec2 describe-security-groups --region $Region --group-ids $sg --output json | ConvertFrom-Json
    $has443 = $sgDetail.SecurityGroups[0].IpPermissions | Where-Object { $_.FromPort -le 443 -and $_.ToPort -ge 443 -and $_.IpProtocol -eq "tcp" }
    if ($has443) {
        Write-Host "SG $sg : port 443 already allowed"
        continue
    }
    if ($DryRun) {
        Write-Host "[DryRun] Would authorize ingress TCP 443 on $sg"
        continue
    }
    aws ec2 authorize-security-group-ingress --region $Region --group-id $sg --protocol tcp --port 443 --cidr 0.0.0.0/0 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Could not add 443 on $sg (duplicate rule or permission issue). Exit code $LASTEXITCODE"
    } else {
        Write-Host "SG $sg : opened TCP 443"
    }
}

if ($DryRun) {
    Write-Host "[DryRun] Would create HTTPS listener and set HTTP to redirect"
    exit 0
}

$newListener = aws elbv2 create-listener --region $Region `
    --load-balancer-arn $albArn `
    --protocol HTTPS --port 443 `
    --certificates CertificateArn=$CertificateArn `
    --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 `
    --default-actions Type=forward,TargetGroupArn=$tgArn `
    --query "Listeners[0].ListenerArn" --output text

Write-Host "Created HTTPS listener: $newListener"

aws elbv2 modify-listener --region $Region `
    --listener-arn $httpListenerArn `
    --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}' | Out-Null

Write-Host "HTTP listener now redirects to HTTPS (301)"

if (-not $SkipAmplify) {
    $albDns = aws elbv2 describe-load-balancers --region $Region --load-balancer-arns $albArn --query "LoadBalancers[0].DNSName" --output text
    Write-Host ""
    Write-Host '*** Next steps (manual) ***'
    Write-Host "1. Create DNS: CNAME YOUR_HOSTNAME -> $albDns"
    Write-Host '2. Set Amplify API_URL to https://YOUR_HOSTNAME and start-job RELEASE'
}
