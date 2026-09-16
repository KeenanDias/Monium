# Monium — Handoff

**Prepared:** August 13, 2026
**Branch:** `add-ios-aws-backend` @ `b1ff929` — 4 commits ahead of `main`, **not merged**
**Local `MoniumApp/` matches the pushed branch** (differences are line endings only)

Everything under "Done" was checked against live AWS and the pushed branch while
writing this, not recalled from memory.

---

## 1. What Monium is

A web app (PWA) that answers one question: *how much can I safely spend today?*

It connects to a Canadian bank through Plaid, finds recurring bills and the
paycheck, subtracts bills and savings from income, and spreads the rest across the
days until the next payday. You install it to your iPhone home screen from Safari —
no Mac, no App Store.

**Architecture:**

```
iPhone (Safari / home screen)
   │  app.html  +  js/api.js
   ▼
API Gateway  z2t5gxylo8 / prod        ← CORS locked to https://monium.ca
   │
   ├─ POST /auth                  → monium-auth                 (bcrypt + JWT)
   ├─ POST /kyc                   → monium-kyc                  (onboarding profile)
   ├─ POST /plaid                 → monium-plaid-link-token     (starts Plaid Link)
   ├─ POST /plaid-exchange        → monium-plaid-exchange       (stores access token)
   └─ POST /process-transactions  → monium-process-transactions (safe-to-spend)
                                            │
                     DynamoDB MoniumUsers ◄─┴─► Secrets Manager
                                            │
                                     Plaid Sandbox (CA)
```

---

## 2. Done

### AWS infrastructure — account `175312555916`, region `us-east-1`

| Resource | Name | State |
|---|---|---|
| DynamoDB | `MoniumUsers`, GSI `EmailIndex` | Active, **0 users** |
| S3 | `monium-lambda-175312555916` | Versioned; holds deploy packages |
| IAM role | `MoniumLambdaRole` | Basic execution, DynamoDB, Secrets Manager |
| IAM user | `monium-dev` | 6 managed policies; CLI access keys |
| Secret | `monium/plaid-secret` | Valid JSON, sandbox `client_id` + `secret` |
| Secret | `monium/jwt-secret` | Random 48-byte key |
| Secret | `monium/openai-api-key` | **Unused placeholder** |
| Lambda ×5 | see diagram | `nodejs22.x`, all deployed |
| API Gateway | `z2t5gxylo8`, stage `prod` | 5 POST routes, `OPTIONS` on each |

**Base URL:** `https://z2t5gxylo8.execute-api.us-east-1.amazonaws.com/prod`

### Verified working

- Register, login, wrong password, unknown email — the last two return the
  identical `Invalid email or password`
- `/plaid` returns a real Plaid sandbox link token (Canada)
- `/process-transactions` and `/plaid-exchange` run the current code
- CORS preflight from `https://monium.ca` returns the right headers; POST
  responses carry `Access-Control-Allow-Origin`

### Backend code

- **Passwords:** bcrypt, cost 12 (was unsalted SHA-256)
- **JWT signing key:** from Secrets Manager; the function refuses to start without
  one (was a hardcoded `'dev-secret-key'` fallback)
- **Categorization:** Plaid's own `personal_finance_category` plus
  `/transactions/recurring/get` — OpenAI removed, so no Plaid data leaves AWS
- **Safe-to-spend fixes:** recurring bills normalized to monthly (was subtracting
  90 days of bills from one month of income); income taken from detected deposits
  when available; budget runs to next predicted payday instead of a fixed 30 days;
  transactions paginated past 500
- **Plaid access token** is exchanged and stored server-side and never sent to the
  browser
- **Only computed results are stored**, not copies of transactions
- **Deploy script fixed:** wrong paths, missing `node_modules`, broken zip format,
  wrong `create-function` flags, retired runtime, and it reporting success while
  failing

### Frontend (repo root)

- **`js/api.js`** — session handling, bearer token, clears session on 401/403,
  full Plaid connect flow. `userId` always comes from the stored session.
- **`app.html`** — runs two modes through the same screens: demo numbers when
  signed out, live API numbers when signed in. New sign-in screen; Connect opens real
  Plaid Link; dashboard, review, and chat read live figures. JSX verified to compile.
- **Icons** — `icons/icon-180.png`, `icon-192.png`, `icon-512.png`: black serif M on
  white.

### Docs

`PWA_GUIDE.md` (build guide), `AWS_SETUP.md` (updated for the email index).

---

## 3. Not verified

**The full flow has never run in a real browser.** Sign-in → Plaid Link → exchange
→ dashboard is wired and each endpoint works on its own, but nobody has clicked
through it end to end. It can't be tested yet: `monium.ca` isn't serving anything,
and `localhost` is blocked by CORS. Expect bugs on the first real run.

---

## 4. To do

### P0 — get it onto a phone

**1. `monium.ca` doesn't resolve.** The domain exists at Cloudflare but has no
website attached (DNS has an SOA record and no A record). Create a Cloudflare Pages
project connected to `KeenanDias/Monium`, then add `monium.ca` as a custom domain.

**2. Merge the branch.** `main` is the live landing page. Review
`add-ios-aws-backend`, then merge so Pages deploys it — or point Pages at the branch
for a first test.

**3. The app draws a fake phone around itself.** `app.html` renders inside a
390×760 frame with a black bezel, a fake notch, and a fake status bar ("9:41",
battery). That's right for a desktop demo. Installed on an iPhone it becomes a phone
drawn inside a phone. `.standalone` in `css/app.css` only changes the background, so
nothing handles this yet. The frame, notch, and `StatusBar` need to drop away on a
real device so the app fills the screen.

**4. PWA files don't exist.** No `manifest.json`, no `sw.js`, no iOS meta tags, no
`viewport-fit=cover`. The icons are ready. Code is in `PWA_GUIDE.md` §4.

**5. Local testing is blocked.** CORS allows only `https://monium.ca`, so
`localhost` fails, and so will Cloudflare preview URLs (`*.pages.dev`). The `OPTIONS`
methods are static mock integrations that can only return one fixed origin. To allow
more than one: switch `OPTIONS` to the Lambda, have the Lambdas check the request's
`Origin` against a short allowlist and echo back a match, and redeploy.

### P1 — before anyone except you uses it

**6. The API has no authorization.** All five routes are `authorizationType: NONE`,
and there are no authorizers. Anyone who knows or guesses a `userId` can:
- **read that person's finances** — `/process-transactions` returns their income,
  bills, and spending by category
- overwrite their profile via `/kyc`
- attach their own bank to that account via `/plaid-exchange`

The JWT is issued but never checked. Fix: a Lambda authorizer that verifies the
signature and expiry and rejects requests where the token's `userId` doesn't match
the body.

**7. Rotate the JWT secret.** Its value was printed in plain text during the
checks for this handoff. It's also set as an environment variable on all five
functions, though only `monium-auth` uses it (the authorizer will need it too).
Rotating is free right now because there are 0 users and no tokens to invalidate.
Better: read it from Secrets Manager at cold start instead of an environment
variable.

**8. JWT format.** It uses base64 instead of base64url, so standard JWT libraries
can't parse it. Fix it while building the authorizer.

**9. Account basics you've promised Plaid.** No MFA, password reset, or email
verification. Your Plaid answers commit to MFA before production. Cognito provides
all three and stays in AWS.

**10. Registration leaks account existence.** Login returns a generic error, but
register still says `User already exists`.

### P2 — correctness and cleanup

| # | Issue | Where |
|---|---|---|
| 11 | New accounts with under 90 days of history get spending inflated (e.g. ~6× with two weeks) | `monthlySpendByCategory()` |
| 12 | Goal `"$5,000"` parses to `NaN`, so the savings target silently becomes 0 | `monthlySavingsTarget()` |
| 13 | **Recurring Transactions coverage in Canada is untested** — the whole calculation depends on it. Test with a Canadian sandbox bank first. | Plaid |
| 14 | Rename `kyc` → `profile` (route, Lambda, DynamoDB attribute) | everywhere |
| 15 | Statement upload is a placeholder in live mode | `ScreenConnect` |
| 16 | Chat is scripted pattern matching, not AI. Adding OpenAI changes your Plaid data answers. | `handleUser()` |
| 17 | React development builds and in-browser Babel — slow on phones | `app.html` `<head>` |
| 18 | `aws-sdk` v2 is end-of-life and bulky; v3 is built into the runtime | all Lambdas |
| 19 | Delete the unused `monium/openai-api-key` | Secrets Manager |
| 20 | `CREATE_XCODE_PROJECT.md` and `AUGUST_12_LAUNCH_PLAN.md` are obsolete (Swift plan, past date) | `MoniumApp/` |

---

## 5. Plaid production application

**Not submitted.** Build on sandbox until P0 and P1 are done — the security
questions get much easier to answer once MFA and authorization exist.

The drafted answers exist only in chat history. Save them before they're lost:

- **Product description** (997 characters) — **says "US"; change it to Canada**
- **Products:** Transactions, Recurring Transactions, Balance. Income was
  recommended off (it's in the underwriting group and nothing calls it).
- **Use cases:** Transactions → "Personal budgeting and financial advice";
  Balance → "Other", read-only display
- **Security Q1–Q4:** contact info, "operational program, no documented policy" with
  explanation, access controls (RBAC + centralized IAM only), MFA "No" with
  explanation

Re-check every answer against the code before submitting. Several describe future
work as commitments.

---

## 6. Runbook

```powershell
# Deploy all Lambdas (from MoniumApp/)
.\deploy-lambdas.ps1 -AccountId 175312555916

# Re-apply CORS after adding a route
.\add-cors.ps1 -ApiId z2t5gxylo8 -Origin https://monium.ca

# Update Plaid keys - escape inner quotes, or the Windows CLI strips them
aws secretsmanager put-secret-value --secret-id monium/plaid-secret `
  --secret-string "{\`"client_id\`":\`"ID\`",\`"secret\`":\`"SECRET\`"}" --region us-east-1

# Check for leftover test users
aws dynamodb scan --table-name MoniumUsers --select COUNT --region us-east-1
```

**Plaid sandbox login:** `user_good` / `pass_good`

**Known traps:**
- A strange `Cannot find module` error means a corrupt npm cache:
  `npm cache clean --force`, delete `node_modules`, reinstall
- PowerShell scripts containing emoji need a UTF-8 BOM, or 5.1 fails to parse them
- A browser at the API URL shows `Missing Authentication Token` — that means "no
  GET route here", not an auth failure

---

## 7. Accounts

| Service | Used for |
|---|---|
| AWS `175312555916` | Everything backend (root + `monium-dev`) |
| Plaid dashboard | Sandbox keys; production application |
| Cloudflare | `monium.ca` domain; Pages hosting (not set up) |
| GitHub `KeenanDias/Monium` | Code |
| Supabase | Landing page beta signups only — not part of the app |
