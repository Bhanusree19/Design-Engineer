# Design Engineer — Deployment 05 (Cloudflare Workers Paid, per-job Containers)

This is the **new scalable Cloudflare architecture**, separate from Deployment 04.
Only branch `design-engineer-cloudflare-deployment-05` is changed.
**OpenCode free models and user-owned provider/API key options are unchanged.**

## What runs where

- **API Container (one named instance):** existing Express API, Supabase login, Google/GitHub OAuth, project/repository selection, model verification, screen extraction and planning. One instance is deliberate because legacy OAuth state is process-local.
- **Cloudflare Queue:** stores job IDs only, never Figma context, GitHub tokens, Codex credentials or provider API keys.
- **Execution Container (unique instance per implementation job):** starts a separate Node/Git/coding-agent environment for each approved implementation, using `getContainer(JOB_CONTAINER, 'job-'+jobId)`. It loads only the job's authenticated account context from staging Supabase, clones the repo, runs the existing selected agent, commits, and creates the PR. The instance exits on completion.
- **Supabase:** stores owner-scoped job records and encrypted short-lived Supabase access tokens while a job runs, clears those encrypted tokens on success/failure, and stores status/result.
- **Figma plugin:** accepts a job ID immediately and polls `/api/jobs/:id` until PR creation or error. Closing Figma does not cancel the running container, but this first version does not yet resume the progress UI automatically after reopening.

### Concurrency and billing

The old process-wide `activeImplementation` lock has been **removed**.
`cloudflare/wrangler.jsonc` configures a **single API container** and a
**job container pool of up to 1000 instances**. This is a platform deployment
capacity ceiling, **not** a $5 monthly spending cap or a per-user quota.
If enough jobs arrive, Cloudflare Queue and Container capacity determine
when they run. For more than 1000 concurrent jobs, increase the configured
`max_instances` (subject to Cloudflare account limits) and redeploy.
Cloudflare metered usage can cost more than the Workers Paid $5 base fee.

The current implementation is a **staging release**, not a certified untrusted
multi-tenant production service. See the limitations below before inviting users.

## End-to-end setup — Windows PowerShell

### 1. Create Cloudflare account and enable paid Containers

1. Open https://dash.cloudflare.com/ and upgrade Workers to **Workers Paid ($5/month base)**.
2. Check your account has Containers and Queues available.
3. Install Node.js 22+, Git, Docker Desktop (Linux containers), and run Docker Desktop.
4. Use a separate **staging** Supabase project and GitHub OAuth App. Do not overwrite your production credentials.

### 2. Get the new branch (repository root)

```powershell
git fetch origin
git switch design-engineer-cloudflare-deployment-05
git pull origin design-engineer-cloudflare-deployment-05
```

Deployment 04 stays unchanged.

### 3. Apply the new Supabase migration

Open **staging Supabase → SQL Editor**, paste and run:

`design-engineer-backend/supabase/007_implementation_jobs.sql`

This migration adds `implementation_jobs` with user-level RLS, encrypted
session credential storage and durable `queued/running/completed/failed` status.
The backend must be granted a **staging** service-role key, but it must never
be put in the Figma frontend. Previous staging migrations 004–006 must already
be applied. Do **not** run this migration against production unless you
deliberately promote the tested release.

### 4. Create Cloudflare Queue and dead-letter queue

Open PowerShell at the repository root:

```powershell
cd cloudflare
npm install
npx wrangler login
npx wrangler queues create design-engineer-v05-jobs
npx wrangler queues create design-engineer-v05-jobs-dlq
```

Create each queue only once. If Cloudflare says it already exists, keep it.
The Queue name is already wired in `wrangler.jsonc`; no need to paste any
credentials into the queue configuration.

### 5. Deploy Worker and Container image

Keep Docker Desktop running **during deployment**:

```powershell
npm run deploy
```

This automatically stages only non-secret backend files, builds the Node 22
coding-agent Docker image, pushes it to Cloudflare, and deploys the Worker,
the shared API container class, and the per-job container class.

Record the displayed HTTPS URL, for example:

`https://design-engineer-containers-v05.YOUR-SUBDOMAIN.workers.dev`

No persistent local Docker or Cloudflare Tunnel is required after deployment.

### 6. Prepare the **staging** backend .env (on your PC)

Edit `design-engineer-backend/.env` locally, *never commit it*:

```dotenv
PORT=4000
BACKEND_URL=https://design-engineer-containers-v05.YOUR-SUBDOMAIN.workers.dev
SUPABASE_URL=https://YOUR-STAGING-PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_STAGING_SUPABASE_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_STAGING_SUPABASE_SERVICE_ROLE_KEY
GITHUB_CLIENT_ID=YOUR_STAGING_GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET=YOUR_STAGING_GITHUB_CLIENT_SECRET
ENCRYPTION_KEY=YOUR_EXISTING_STAGING_64_CHAR_HEX_ENCRYPTION_KEY
GATEWAY_SHARED_SECRET=YOUR_NEW_RANDOM_64_CHAR_HEX_GATEWAY_SECRET
```

Generate a gateway secret using PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If your development Supabase already stores encrypted provider connections,
**preserve the original ENCRYPTION_KEY**. Use a freshly generated key for a
brand-new empty staging Supabase project only.

Model-provider credentials are still connected by users within the Figma
plugin and encrypted per user. **OpenCode behavior has not changed.**

### 7. Upload the .env values into Cloudflare Secrets

From the `cloudflare/` directory in PowerShell:

```powershell
.\scripts\upload-secrets.ps1
```

The script uploads the eight backend values above **except PORT** using
Wrangler's secret store. It never prints their contents. Every new environment
change requires reuploading changed secrets to Cloudflare; merely editing
your PC's `.env` is not enough.

If the container started before secret upload, redeploy or restart it after
the secrets are present.

### 8. Configure a separate staging GitHub OAuth App

At https://github.com/settings/developers → OAuth Apps → New OAuth App:

- **Name:** Design Engineer Cloudflare Staging
- **Homepage URL:** your Worker HTTPS URL
- **Authorization callback:**
  `https://YOUR-WORKER-URL/auth/github/callback`

Copy that app's Client ID/Secret to the staging `.env` and upload secrets
again. Keep your production OAuth App and callback unchanged.

### 9. Configure staging Supabase / Google login

Go to **staging Supabase → Authentication → URL Configuration** and allow:

`https://YOUR-WORKER-URL/auth/google/callback/**`

Keep existing development localhost redirects if needed. The Google Cloud
OAuth redirect is still your **Supabase** endpoint:

`https://YOUR-STAGING-PROJECT.supabase.co/auth/v1/callback`

Do **not** replace Google's OAuth redirect with your Worker URL.

### 10. Build the Figma development plugin

From the repository root, in a new PowerShell session:

```powershell
cd design-engineer-plugin
$env:DESIGN_ENGINEER_API_URL="https://YOUR-WORKER-URL"
npm ci
npm run watch
```

Open Figma Desktop and reload the **development** plugin. The branch's
development manifest allows `workers.dev`. Do not publish the production
plugin yet.

### 11. Smoke-test every stage

1. `https://YOUR-WORKER-URL/__edge/health` reports paid/per-job-container mode.
2. `https://YOUR-WORKER-URL/healthz` returns Express backend health.
3. Test email/Google sign-in, GitHub OAuth, project/repo/branch selection.
4. Test Codex, Claude, OpenCode and Direct APIs using your existing models
   and your *own* staging credentials.
5. Fetch a small Figma screen → review plan → approve implementation.
6. The plugin now says **queued**, then **running**, then **completed**,
   providing a PR link on success.
7. Test User A and User B simultaneously: two different job IDs must create
   **two different Cloudflare execution containers**. Confirm independent
   GitHub PRs and credential ownership.
8. Check Queue backlogs, dead-letter queue, Container instances and billing.
9. Review Cloudflare logs: `npx wrangler tail`,
   `npx wrangler containers list`.

Do not run CLI users against the same real private repository during your
first test. Start with separate disposable repositories.

## Important remaining operational limitations

- **OAuth restart safety:** the API container retains device/OAuth state in
  memory. Restarting it during GitHub/Google/Codex auth can require signing in
  again; move OAuth state to durable storage before public scale.
- **Job crash recovery:** a queue message is acknowledged after the job
  container accepts dispatch, not after the GitHub PR is finished. If the
  container dies later, status can remain `running`; further watchdog/recovery
  logic is needed before reliable production release.
- **Token expiry:** the user-scoped short-lived encrypted Supabase JWT is
  captured at submission time; a very long queue wait can cause expiry
  before execution. It is erased after completion/failure. Expired jobs need
  a renewed user authorization and retry.
- **Control-plane secrets:** job Containers still receive service credentials
  because the current backend controls GitHub and model connections. The coding
  agent subprocess drops privileges and receives only selected credentials,
  but stronger brokered secret delivery and network egress controls are needed
  for a hardened multi-tenant service.
- **Quota:** anonymous OpenCode free-model provider limits remain controlled
  by OpenCode/provider policy, not by Figma accounts or Container IDs.
  This branch deliberately does **not** alter OpenCode free-model options.
- **Costs and platform capacity:** `max_instances:1000` is infrastructure
  capacity configuration, not a spending cap. Monitor Cloudflare metered usage
  and limits. Workers Paid can exceed $5.
- **Monitoring:** implement alerting, idempotent retries, job cancellation,
  dead-letter replay and event persistence before inviting general public.

## Official documentation

- https://developers.cloudflare.com/containers/get-started/
- https://developers.cloudflare.com/containers/platform/limits/
- https://developers.cloudflare.com/queues/get-started/
- https://developers.cloudflare.com/queues/configuration/configure-queues/
- https://developers.cloudflare.com/workers/configuration/secrets/
