# Design Engineer — Cloudflare Workers Paid + Containers (Deployment 05)

Branch: \`design-engineer-cloudflare-deployment-05\`

**This is a deployable Cloudflare Containers staging configuration**, not a
certified multi-tenant production system. Deployment 04 is unchanged.
The previous Workers Free + Quick Tunnel instructions have been replaced.
With Workers Paid ($5/month base subscription), you do **not** need to run
Docker or cloudflared continuously on your PC. Cloudflare starts the backend
container when requests arrive.

## Important cost and security notes

- Workers Paid unlocks Cloudflare Containers. Containers also have **usage-based
  CPU, RAM, disk, network, Durable Object, and logs billing**; your total bill
  can exceed $5. This configuration starts with **one standard-1 instance**
  (1/2 vCPU, 4 GiB RAM, 8 GB disk). It sleeps after 20 minutes of inactivity.
  Adjust sleepAfter/instance type after measuring load and costs.
- This is a single named API instance for compatibility with the existing
  in-memory GitHub/Google OAuth state and Codex device auth state. A restart
  during OAuth, planning or a long implementation may interrupt the operation.
  There is **no durable work queue** or resume/cancel API yet.
- CLI jobs get a fresh Unix UID, home and repository workspace with restricted
  access; Codex device login no longer inherits server environment secrets.
  Supabase credentials are stored encrypted per user/provider and retrieved
  using authenticated user IDs. This is useful defense in depth but **not a
  substitute for running each untrusted coding job in its own hardened
  container/VM**. Do not publish to untrusted users until per-job isolation,
  sandbox network boundaries and a security review are complete.
- A single implementation may run at a time; other implementation attempts
  return HTTP 429 \`IMPLEMENTATION_BUSY\`. This is NOT per-user rate metering.
- OpenCode free models have **provider-defined** quotas (which can change);
  free does not mean unlimited or guaranteed anonymous access. Design Engineer
  does not implement a provider billing ledger or per-user usage allowance.
  OpenCode and its model provider determine available capacity. At a shared
  Cloudflare egress IP, some upstream limits may be shared. You should not
  represent the $5 Workers fee as paying for OpenCode or other model APIs.
- Direct API providers (Gemini, DeepSeek, OpenAI, Anthropic) charge/limit
  usage according to each provider, separate from the Cloudflare bill.

## Architecture

Figma Development Plugin (HTTPS) → Worker
\`design-engineer-containers-v05.YOUR-SUBDOMAIN.workers.dev\` →
sticky Cloudflare \`DesignEngineerContainer\` instance →
Node 22 Express + Git + installed Codex/Claude Code/OpenCode →
development Supabase, GitHub, and model providers.

The Worker checks the required configuration, overwrites a private gateway
header, and forwards existing API/OAuth routes to the single named container.
The container gets its configuration **only** through Workers secrets via
\`envVars\` in \`cloudflare/src/paid-containers.js\`.
The Figma workflow and API endpoints remain the same as Deployment 04.
All instance filesystem state is ephemeral; persistent credential records
live in Supabase, not the container filesystem.

## Step 1 — Cloudflare Paid plan

1. Go to https://dash.cloudflare.com/ and log in.
2. Switch your Workers plan to **Workers Paid ($5/month base)**.
3. Confirm the **Containers** feature is available under Workers & Pages.
4. Monitor the **Billing/Usage** sections and set spending alerts where
   offered. Additional metered usage can exceed the base fee.

Official docs: https://developers.cloudflare.com/containers/get-started/
and https://developers.cloudflare.com/containers/pricing/

## Step 2 — Prepare local tools

Install:
- Git + Node.js 22 or later
- Docker Desktop, with Linux containers enabled and Docker running
- Windows PowerShell
- Figma Desktop (for testing the development plugin)

In the repo root:

\`\`\`powershell
git fetch origin
git switch design-engineer-cloudflare-deployment-05
git pull origin design-engineer-cloudflare-deployment-05
docker info
\`\`\`

## Step 3 — Log into Cloudflare and deploy the Worker/Container image

Open a new PowerShell terminal **in the repository root**:

\`\`\`powershell
cd cloudflare
npm install
npx wrangler login
npm run deploy
\`\`\`

\`npm run deploy\` automatically runs \`prepare:image\`:
only the backend source/package files are staged into the Docker build context;
\`.env\`, Codex auth and node_modules are excluded. Wrangler then builds the
Docker image, pushes it to Cloudflare's registry, and deploys the Worker.
**Do not run \`docker run\` or start cloudflared** for this paid deployment.

After Wrangler finishes, note the generated URL, e.g.:

\`\`\`text
https://design-engineer-containers-v05.YOUR-SUBDOMAIN.workers.dev
\`\`\`

The Worker can be deployed before secrets are set; normal API routes will
show 503 \`CLOUDFLARE_CONFIG_MISSING\` until Step 5.

Validate container deployment status:

\`\`\`powershell
npx wrangler containers list
\`\`\`

An initial container rollout may take a few minutes. Cloudflare requires
Docker on the **deployment computer** to build/push the image, but your
computer does **not** need to remain running after successful deployment.

## Step 4 — Prepare production-like staging credentials locally

**Use a separate staging Supabase project** and a separate staging GitHub
OAuth App, not your existing production service accounts. For a fresh
staging Supabase database, run \`design-engineer-backend/supabase/schema.sql\`
then migrations \`004_multi_agent.sql\`, \`005_gemini_direct_api.sql\`,
and \`006_four_direct_api_providers.sql\`. If that project already has those
migrations, do not rerun them.

Edit \`design-engineer-backend/.env\` on your own machine (never commit it).
You can keep the values from local testing but **change BACKEND_URL to your
new Cloudflare Worker URL**, not localhost:

\`\`\`dotenv
PORT=4000
BACKEND_URL=https://design-engineer-containers-v05.YOUR-SUBDOMAIN.workers.dev
SUPABASE_URL=https://YOUR-STAGING-PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_STAGING_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_STAGING_SERVICE_ROLE_KEY
GITHUB_CLIENT_ID=YOUR_STAGING_GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET=YOUR_STAGING_GITHUB_CLIENT_SECRET
ENCRYPTION_KEY=YOUR_EXISTING_STAGING_64_CHAR_HEX_ENCRYPTION_KEY
GATEWAY_SHARED_SECRET=YOUR_SEPARATE_64_CHAR_RANDOM_GATEWAY_SECRET
\`\`\`

To generate a fresh secret:

\`\`\`powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
\`\`\`

Run that command twice when starting a **new empty staging database**, once
for \`ENCRYPTION_KEY\` and once for \`GATEWAY_SHARED_SECRET\`. If encrypted
staging records already exist, preserve the **old staging ENCRYPTION_KEY**
instead of regenerating it. The new gateway secret need not match it.

No user Gemini/DeepSeek/OpenAI/Anthropic key belongs in \`.env\`; users connect
those inside the Figma plugin, stored encrypted per account in staging
Supabase. Do not put your production API keys in staging.

## Step 5 — Upload secrets into Cloudflare

Your \`design-engineer-backend/.env\` is **not** automatically uploaded to
Cloudflare by Docker or Wrangler. This branch includes a PowerShell script
that securely sends the required values to Cloudflare Workers Secrets.

From the **cloudflare/** directory:

\`\`\`powershell
.\scripts\upload-secrets.ps1
\`\`\`

This sets the eight required Worker secrets:

\`\`\`text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
ENCRYPTION_KEY
BACKEND_URL
GATEWAY_SHARED_SECRET
\`\`\`

The Worker automatically passes them to its Container on startup.
Never add them to \`wrangler.jsonc\`, your published Figma plugin, or GitHub.
You can alternatively run \`npx wrangler secret put SECRET_NAME\` eight
times manually, pasting the relevant secret at each prompt.

After setting secrets, restart the container if it is already running (or
deploy again) to ensure fresh envVars are applied; do not rotate secrets
mid-job. Keep the Worker URL constant across the OAuth callback settings.

## Step 6 — New GitHub OAuth App for Cloudflare

In https://github.com/settings/developers:

1. OAuth Apps → **New OAuth App**.
2. Name: \`Design Engineer Cloudflare Staging\`
3. Homepage URL:
   \`https://design-engineer-containers-v05.YOUR-SUBDOMAIN.workers.dev\`
4. Authorization callback URL:
   \`https://design-engineer-containers-v05.YOUR-SUBDOMAIN.workers.dev/auth/github/callback\`
5. Register, copy **Client ID** and generate **Client Secret**.
6. Put these in your staging backend \`.env\` and run the upload script again
   if you created the OAuth app after Step 5.

**Never replace your production GitHub OAuth callback URL.**

## Step 7 — Supabase Google Sign-In callback

In **staging Supabase → Authentication → URL Configuration**, add:

\`\`\`text
https://design-engineer-containers-v05.YOUR-SUBDOMAIN.workers.dev/auth/google/callback/**
\`\`\`

You may keep the localhost redirect while testing. For this staging-only
Supabase project the Site URL may be the Worker hostname.

If Google OAuth already works in staging Supabase, **do not change its Client
ID or Client Secret**. The redirect URL registered in **Google Cloud Console**
stays the staging Supabase callback:

\`\`\`text
https://YOUR-STAGING-PROJECT.supabase.co/auth/v1/callback
\`\`\`

Do not register the Worker URL as Google's OAuth callback.

## Step 8 — Point Figma development plugin to Cloudflare

The frontend URL is configured **at build time**, not by modifying
\`src/api/client.ts\`. In PowerShell at repo root:

\`\`\`powershell
cd design-engineer-plugin
$env:DESIGN_ENGINEER_API_URL="https://design-engineer-containers-v05.YOUR-SUBDOMAIN.workers.dev"
npm ci
npm run watch
\`\`\`

Reload/import your local development Figma manifest. It allows workers.dev
domains in its development network permissions. Keep your published Figma
plugin unchanged until testing is complete.

## Step 9 — Verify end-to-end

1. Visit \`https://YOUR-WORKER-URL/__edge/health\`: should report
   \`runtime: workers-paid\`.
2. Visit \`https://YOUR-WORKER-URL/healthz\`: should show the Express backend
   health JSON. A 503 may mean secrets missing, container still provisioning,
   or startup failure.
3. In Figma, test new Google/email login.
4. Connect GitHub using your staging OAuth app.
5. Choose a staging project/repo/branch, then React/React Native stack.
6. Test model verification for Codex, Claude, OpenCode, Gemini, DeepSeek,
   OpenAI, and Anthropic with test accounts/keys as available.
7. Select a small Figma screen, fetch design context, review plan, approve,
   and verify the new GitHub PR in a disposable repo.
8. Test two **distinct** Supabase accounts with their own Codex/Claude/provider
   connections. Verify neither account can list or use the other's secrets.
   Automated tests do NOT substitute for this real two-user check.
9. Test a long-running request and a container restart/redeploy. OAuth and
   in-flight jobs still have restart limitations in this release.

## Logs and troubleshooting

\`\`\`powershell
cd cloudflare
npx wrangler tail
npx wrangler containers list
\`\`\`

In Cloudflare Dashboard → Workers & Pages → Containers, inspect instance
status and logs. API keys, secrets and raw model responses should never be
copied into support tickets. Coding CLI output is intentionally not streamed
verbatim into logs.

- HTTP 503 + \`CLOUDFLARE_CONFIG_MISSING\`: missing Worker secrets.
- HTTP 503 + \`CONTAINER_UNAVAILABLE\`: container is starting or crashed;
  inspect Cloudflare logs.
- HTTP 403 on backend routes: mismatched gateway secret. The Worker and
  container must have the same \`GATEWAY_SHARED_SECRET\`.
- GitHub OAuth callback mismatch: check your GitHub staging app callback and
  \`BACKEND_URL\` against the **exact** Worker HTTPS hostname.
- Supabase Google callback mismatch: check the staging Supabase redirect allowlist.
- HTTP 429 \`IMPLEMENTATION_BUSY\`: another implementation is active. Only
  one at a time in this cost-limited prototype.
- OpenCode model 429: upstream provider rate limit; not a Cloudflare request
  quota. Free-tier access is provider-specific, and not guaranteed unlimited.

## Production-readiness blockers still remaining

Do **not** publish to untrusted multi-user production users solely because
the project builds/deploys:

- Separate job containers/VMs with strict filesystem, network and process
  isolation (the API container is currently shared; per-job UID separation
  is only defense in depth).
- Durable queue and job status/retry/recovery; current implementation can
  outlive connections and is not restart-safe.
- OAuth state persistence across container sleep/redeploy and timeout handling.
- Multi-user end-to-end isolation/authorization tests, security review and
  threat modeling for untrusted repositories and model-generated commands.
- Provider usage/cost tracking, quotas and rate limits; free OpenCode access
  cannot be guaranteed or billed reliably without provider-specific accounts.
- Secrets rotation, audit logging and error redaction review.

Recommended: keep the new Worker in **private staging** until all are addressed.

## Official docs

- https://developers.cloudflare.com/containers/get-started/
- https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/
- https://developers.cloudflare.com/containers/pricing/
- https://developers.cloudflare.com/workers/configuration/secrets/
