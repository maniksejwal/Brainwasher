# Deployment action items — detailed steps

**Region:** `ap-south-1` (unless you change it)

**Quick reference (current research env):**

| Resource | Value |
|----------|--------|
| CloudFormation stack | `Brainwasher3-Stack` |
| ALB DNS | `research-alb-917990411.ap-south-1.elb.amazonaws.com` |
| ECS cluster | `research-cluster` |
| ECS service | `research-service` |
| Target group | `research-tg` |
| ECR repo | `710271912806.dkr.ecr.ap-south-1.amazonaws.com/research-repo` |
| Amplify app | `d1dzfg8k3u9811` (name: **Brainwasher**) |
| Amplify production branch | `research` |
| Cognito (from stack outputs) | Pool `ap-south-1_0bnrHrgdj`, Client `46ambbpt2c3nqckemae0j2ohak` |

---

## A. IAM permissions (admin / account owner)

Grant your deployment IAM user or role at least:

| Area | Typical actions |
|------|------------------|
| **ACM** | `acm:RequestCertificate`, `acm:DescribeCertificate`, `acm:ListCertificates`, `acm:DeleteCertificate` (optional) |
| **Route 53** (if DNS is in Route 53) | `route53:ListHostedZones`, `route53:ChangeResourceRecordSets`, `route53:GetChange` |
| **ELB** | `elasticloadbalancing:*` on listeners / load balancers (or scoped to `research-alb`) |
| **EC2** | `ec2:AuthorizeSecurityGroupIngress`, `ec2:DescribeSecurityGroups` (ALB SG) |
| **ECS** | `ecs:Describe*`, `ecs:RegisterTaskDefinition`, `ecs:UpdateService` |
| **Amplify** | `amplify:GetApp`, `amplify:UpdateBranch`, `amplify:StartJob` |
| **CloudFormation** | `cloudformation:*` on `Brainwasher3-Stack` (if you fix the stack) |
| **ECR** | `ecr:*` for push/pull |

**Why:** Earlier, `acm:RequestCertificate` and `route53:ListHostedZones` were denied for the `yourbhai` user — HTTPS and automated DNS validation could not be completed without broader permissions.

---

## B. HTTPS on the API (ALB)

**Facts:**

- ACM certificates are **per hostname**. You **cannot** use a cert for `api.other-alb.com` while clients hit `research-alb` unless DNS for **that same hostname** points to **`research-alb`**.
- The ALB default DNS (`*.elb.amazonaws.com`) does **not** get a public ACM cert for HTTPS in the usual way — you **choose a host under your domain** (e.g. `brainwasher-api.example.com`).

### B1. Request an ACM certificate (console)

1. **AWS Console** → **Certificate Manager** → Region **ap-south-1** → **Request certificate**.
2. Choose **Request a public certificate**.
3. **Fully qualified domain name:** e.g. `brainwasher-api.yourdomain.com` (add SANs if needed).
4. **Validation method:** **DNS** (recommended).
5. **Create** → ACM shows **CNAME** records for validation.

### B2. Validate the certificate (DNS)

**If Route 53 hosts the zone:**

1. In ACM, click **Create records in Route 53** (if offered), or manually add the CNAME records ACM shows.
2. Wait until status is **Issued**.

**If DNS is external (e.g. Cloudflare, GoDaddy):**

1. Add the **exact** CNAME name/value pairs ACM shows in ACM.
2. Wait until status is **Issued**.

### B3. Point your API hostname at the research ALB

1. Create a **DNS record** for your chosen hostname:

   - **Type:** CNAME (or Alias A to ALB in Route 53 if you use alias).
   - **Target:** `research-alb-917990411.ap-south-1.elb.amazonaws.com`.

2. **Propagate:** wait until `nslookup brainwasher-api.yourdomain.com` (or similar) resolves to the ALB.

### B4. Enable HTTPS on the ALB (script in repo)

From the repo root (PowerShell):

```powershell
cd "D:\Projects\MMT\Chatbot\Brainwasher 3"

.\deploy\enable_alb_https.ps1 `
  -CertificateArn "arn:aws:acm:ap-south-1:ACCOUNT:certificate/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" `
  -DryRun
```

Remove `-DryRun` when the dry run looks correct.

**What it does:**

- Opens **TCP 443** on the ALB security group(s).
- Creates **HTTPS listener** on **443** forwarding to **`research-tg`**.
- Changes **HTTP 80** default action to **301 redirect** to HTTPS.

**Verify:**

```powershell
Invoke-WebRequest -Uri "https://brainwasher-api.yourdomain.com/api/auth/health" -UseBasicParsing
```

(Replace with your real hostname.)

---

## C. Amplify frontend (`API_URL` + Cognito)

**App ID:** `d1dzfg8k3u9811`  
**Branch:** `research` (production)

### C1. Set branch environment variables

**Required:**

| Variable | Example / meaning |
|----------|-------------------|
| `API_URL` | `https://brainwasher-api.yourdomain.com` (must match your HTTPS API hostname after B) **or** `http://research-alb-917990411.ap-south-1.elb.amazonaws.com` for HTTP-only tests |
| `COGNITO_POOL_ID` | Same as `COGNITO_USER_POOL_ID` on backend: `ap-south-1_0bnrHrgdj` |
| `COGNITO_CLIENT_ID` | Same as backend: `46ambbpt2c3nqckemae0j2ohak` |

**CLI example:**

```powershell
$env:AWS_PAGER = ""
aws amplify update-branch `
  --app-id d1dzfg8k3u9811 `
  --branch-name research `
  --region ap-south-1 `
  --environment-variables `
    API_URL=https://brainwasher-api.yourdomain.com,`
    COGNITO_POOL_ID=ap-south-1_0bnrHrgdj,`
    COGNITO_CLIENT_ID=46ambbpt2c3nqckemae0j2ohak
```

### C2. Trigger a new build

```powershell
aws amplify start-job `
  --app-id d1dzfg8k3u9811 `
  --branch-name research `
  --region ap-south-1 `
  --job-type RELEASE
```

### C3. Console parity (optional)

- **Amplify** → App → **Hosting** → **Build settings** → confirm build spec matches what you need (`deploy/amplify.yml` in repo is richer than some minimal inline specs).

### C4. Mixed content warning

- If the site is served as **HTTPS** and `API_URL` is **HTTP**, browsers may **block** the API. After HTTPS on ALB, **set `API_URL` to `https://`** for that hostname.

---

## D. ECS backend (task definition environment)

Task definition family: **`research-task`** (example revision used: `:6` — verify current with AWS).

**Backend should have:**

| Variable | Purpose |
|----------|---------|
| `COGNITO_USER_POOL_ID` | JWT verification |
| `COGNITO_CLIENT_ID` | JWT verification |
| `LLAMA_API_URL` | Llama HTTP API (code has default; explicit is safer) |
| `LLAMA_API_KEY` | If your API Gateway requires it |
| `NODE_ENV` | `production` |
| `PORT` / `HOST` | Match container (e.g. `3000`, `0.0.0.0`) |

**How to update:**

1. **Console:** ECS → Cluster `research-cluster` → Service `research-service` → **Task definition** → **Create new revision** → add env vars → **Update service** → force new deployment.

2. **CLI:** `describe-task-definition` → edit JSON → `register-task-definition` → `update-service` (same pattern as `deploy/deploy_aws.ps1` steps 6–7).

3. **Script:** `deploy/deploy_aws.ps1` registers a revision and injects Cognito from stack outputs **if** the script reaches that step (stack must be `COMPLETE`).

---

## E. Cognito (browser / Hosted UI)

If you use **Cognito Hosted UI** or redirects:

1. **Cognito** → User pools → your pool → **App integration** → **App client** → **Hosted UI** (or OAuth settings).
2. **Callback URL(s)** and **Sign out URL(s):** add  
   - `https://research.d1dzfg8k3u9811.amplifyapp.com/...` (or your custom domain)  
   - `http://localhost:5000/...` if you dev locally (adjust paths to match your app).

3. **Allowed OAuth flows / scopes** as required by your frontend.

---

## F. CloudFormation stack `Brainwasher3-Stack` (optional cleanup)

**Current risk:** `UPDATE_FAILED` with `ECSTaskDefinition` + `--disable-rollback` blocks clean replacement.

**Options:**

1. **Operational:** Keep ECS/ALB as source of truth; document drift; don’t rely on CF for task-definition-only changes.
2. **Fix stack:** Work with **AWS Support** or a senior admin to:
   - Understand failed events: `aws cloudformation describe-stack-events --stack-name Brainwasher3-Stack --region ap-south-1`
   - Consider **`continue-update-rollback`**, or targeted **`resource-import`**, or **remove `--disable-rollback`** on future deploys, or **split** task definition out of the template.

**Not required** for a working API if ECS is already healthy.

---

## G. End-to-end verification (order)

1. **ALB health:**  
   `GET http(s)://<api-host>/api/auth/health` → **200** (or **301** then **200** on HTTPS if redirecting).

2. **Amplify build:** Job **SUCCEED** in Amplify console.

3. **Browser:** Open Amplify URL → open **DevTools → Network** → confirm API calls go to **`API_URL`** and return **200** (not mixed-content blocked).

4. **CLI (optional):**  
   `$env:ORCHESTRATOR_URL='https://brainwasher-api.yourdomain.com'` then run your chat CLI (see `deploy_aws.ps1` summary line for pattern).

---

## H. Who does what (summary)

| Owner | Actions |
|-------|---------|
| **Admin / IAM** | Grant ACM, Route 53, ELB, ECS, Amplify as in **A**. |
| **You (or DevOps)** | **B** (HTTPS), **C** (Amplify), **D** (ECS env if missing), **E** (Cognito URLs), **G** (verify). |
| **Optional** | **F** (CloudFormation recovery). |

---

## I. Quick copy-paste values (research stack outputs)

Use these **only if** they still match your live stack (`aws cloudformation describe-stacks --stack-name Brainwasher3-Stack`):

- **Cognito User Pool ID:** `ap-south-1_0bnrHrgdj`
- **Cognito Client ID:** `46ambbpt2c3nqckemae0j2ohak`
- **ALB DNS:** `research-alb-917990411.ap-south-1.elb.amazonaws.com`

**Replace with your own HTTPS hostname** in `API_URL` once **B** is done.
