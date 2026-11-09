# Design Engineer — Cloudflare Workers Free staging (Deployment 05)

> **This branch is for FREE-TIER EVALUATION, not complete production hosting.**
> Cloudflare Workers Free **cannot run** Codex CLI, Claude Code CLI, OpenCode CLI,
> Git worktrees, Docker containers, or the current Express backend. Containers
> require the paid Workers plan. This deployment places a lightweight
> Cloudflare Worker **gateway** in front of a separately running backend.
>
> In the completely free test described here, the existing Node 22/Docker
> backend stays on **your Windows PC**, reachable via a temporary Cloudflare
> Quick Tunnel. Closing Docker, closing the tunnel, or sleeping the PC stops
> the application. This is **not** an always-on/free hosted coding backend.
>
> Branch: \`design-engineer-cloudflare-deployment-05\`, branched from
> \`design-engineer-deployment-04-cloudflare-agents\`.
> Deployment 04 and its live/production settings are not modified.

## Architecture

Figma **development** plugin → Cloudflare **Workers Free** HTTPS URL →
Worker gateway (\`cloudflare/src/free-gateway.js\`) →
**HTTPS** origin (temporary \`trycloudflare.com\` tunnel OR a separately hosted
staging backend) → existing Express server and coding CLIs in Docker → existing
development Supabase/GitHub/model provider APIs.

The Worker is a strict reverse proxy, **not** the coding-agent runtime:
- \`/auth/*\`, \`/api/*\`, \`/healthz\` proxy to the configured backend.
- \`/__edge/health\` reports only edge configuration status.
- Only allowlisted app paths are forwarded; HTTPS origin is validated.
- Worker overwrites the private gateway header; backend verifies the same
  secret before handling protected routes.
- No OAuth tokens, Figma context, or API responses are cached.
- Existing backend GitHub OAuth, Google OAuth, agent selection, model verification,
  plan review, screen extraction, Git operations, and PR creation are reused.

**Limits:** Workers Free currently provides 100,000 requests/day and
10 ms CPU time/request (wall time for connected HTTP requests is different).
Never depend on an open Figma/HTTP request for durable background jobs.
This branch still lacks a persistent job queue, restart-safe OAuth state, and
per-job process/container isolation. Do not expose as a public multi-user
production service without implementing those controls.

## Before you start

- Windows PC with Docker Desktop, PowerShell, Node.js 22+, Figma Desktop,
  and the **\`cloudflared\` command** installed.
- Cloudflare Free account. No payment information should be necessary for
  just the Worker Free + Quick Tunnel approach.
- A **development Supabase** project with the same Deployment 04 schema,
  including migrations \`004_multi_agent.sql\`, \`005_gemini_direct_api.sql\`,
  \`006_four_direct_api_providers.sql\`. Run original \`schema.sql\` before
  migrations only for a new/empty dev database. **Do not migrate production.**
- A **separate GitHub OAuth App** for this Cloudflare staging URL (do not
  overwrite your production OAuth callback).
- Development Google sign-in configured in your development Supabase project.
- The existing \`Dockerfile.cloudflare\` builds a Node backend with Codex,
  Claude Code, and OpenCode CLIs. It is used on your PC, NOT uploaded to
  Cloudflare Containers on the Free plan.

## Step 1 — Pull this new branch (PowerShell in repository root)

\`\`\`powershell
git fetch origin
git switch design-engineer-cloudflare-deployment-05
git pull origin design-engineer-cloudflare-deployment-05
\`\`\`

No files in Deployment 04 need to be edited.

## Step 2 — Create and deploy the Workers Free gateway

1. Go to https://dash.cloudflare.com/ and make/log in to a Cloudflare Free account.
2. In a PowerShell terminal from the repository root:

\`\`\`powershell
cd cloudflare
npm install
npx wrangler login
npx wrangler deploy
\`\`\`

3. If prompted, select your Cloudflare account; leave the configured Worker
   name \`design-engineer-free-gateway\` (or change it to avoid a name clash).
4. Wrangler displays your **public gateway URL**, for example:
   \`https://design-engineer-free-gateway.YOUR-SUBDOMAIN.workers.dev\`.
   Copy this exact URL. No custom domain is required for staging.
5. Visit \`https://YOUR-WORKER-URL/__edge/health\`.
   Initially \`backendConfigured\` and \`authConfigured\` will be false.
   This is expected until you set the Worker secrets below.

**Important:** A Cloudflare Worker by itself does not start or install
your backend, Git, Codex, Claude Code, OpenCode, or database.

## Step 3 — Create a strong gateway secret

In PowerShell (locally):

\`\`\`powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
\`\`\`

Save the generated value securely. This is a **new gateway-only secret**,
not your Supabase service role key or ENCRYPTION_KEY.

### Backend \`.env\` (development only)

Edit \`design-engineer-backend/.env\` on your PC (NOT in Git):

\`\`\`dotenv
PORT=4000
BACKEND_URL=https://design-engineer-free-gateway.YOUR-SUBDOMAIN.workers.dev
SUPABASE_URL=https://YOUR-DEV-PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_DEV_PUBLISHABLE_OR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_DEV_SERVICE_ROLE_KEY
GITHUB_CLIENT_ID=YOUR_STAGING_GITHUB_OAUTH_CLIENT_ID
GITHUB_CLIENT_SECRET=YOUR_STAGING_GITHUB_OAUTH_CLIENT_SECRET
ENCRYPTION_KEY=YOUR_EXISTING_DEV_ENCRYPTION_KEY
GATEWAY_SHARED_SECRET=YOUR_NEW_64_CHARACTER_RANDOM_GATEWAY_SECRET
\`\`\`

Keep \`ENCRYPTION_KEY\` unchanged if this **development Supabase** project
already has saved encrypted GitHub/agent connections. Use a new key only
when starting with a new empty development database.
**Never use production secrets or the production database here.**

The backend \`BACKEND_URL\` MUST be the **public Worker URL**, not localhost
or your temporary tunnel URL, because the backend builds the OAuth callback
URLs from \`BACKEND_URL\`.

## Step 4 — Build and start the local Docker backend

In PowerShell at repository root:

\`\`\`powershell
docker stop design-engineer-v04
docker rm design-engineer-v04
docker build -f Dockerfile.cloudflare -t design-engineer-cloudflare-v05 .
docker run --rm --name design-engineer-v05 -p 4000:4000 --env-file design-engineer-backend/.env design-engineer-cloudflare-v05
\`\`\`

Stop/remove commands can print "No such container" if you already stopped
the previous local test; that's safe to ignore.
Leave the terminal running. Check \`http://localhost:4000/healthz\`.

Note: When \`GATEWAY_SHARED_SECRET\` is set, most API/auth endpoints accessed
**directly** on localhost intentionally return HTTP 403; access them through
the Cloudflare gateway. The public \`/healthz\` endpoint remains available.

## Step 5 — Expose the local backend temporarily with a free Tunnel

In a **second PowerShell terminal**:

\`\`\`powershell
cloudflared tunnel --url http://localhost:4000
\`\`\`

Copy the temporary HTTPS URL printed by cloudflared, e.g.
\`https://random-words.trycloudflare.com\`. Keep cloudflared running.

This URL is **temporary**: it changes when you restart the tunnel.
Do not use it as the Figma backend URL or an OAuth callback. It is ONLY
the Worker-to-origin target. Cloudflare Quick Tunnels are for testing,
not always-on production hosting.

See: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/

## Step 6 — Set the two Cloudflare Worker secrets

In another PowerShell terminal, from \`cloudflare/\`:

\`\`\`powershell
npx wrangler secret put BACKEND_ORIGIN
\`\`\`

At the prompt paste **only** the temporary
\`https://random-words.trycloudflare.com\` URL.

Then:

\`\`\`powershell
npx wrangler secret put GATEWAY_SHARED_SECRET
\`\`\`

Paste **the same random value** used in
\`design-engineer-backend/.env\` as \`GATEWAY_SHARED_SECRET\`.

Only these two values are needed in the Worker. The Supabase service key,
GitHub client secret, model-provider API keys, and encryption key remain
**only on your separately running backend** (and encrypted provider keys
in development Supabase). Do not commit secrets to GitHub or Wrangler
config files.

If the tunnel URL changes, repeat
\`npx wrangler secret put BACKEND_ORIGIN\` with the new URL.

## Step 7 — Test the gateway

Replace \`YOUR-WORKER-URL\` with the actual HTTPS Worker hostname.

- \`https://YOUR-WORKER-URL/__edge/health\` → JSON with
  \`backendConfigured: true\` and \`authConfigured: true\`.
- \`https://YOUR-WORKER-URL/healthz\` → existing Express backend
  health JSON: \`{"ok":true,"service":"design-engineer-backend"}\`.
- Backend logs: \`docker logs -f --tail 100 design-engineer-v05\`.
- Worker live logs: \`cd cloudflare; npx wrangler tail\`.

A \`502\` usually means Docker/tunnel/origin is unreachable.
A \`403\` on API/auth generally indicates a missing/mismatched shared secret.
A \`503\` from the gateway indicates the Worker secrets are not configured.

## Step 8 — Update GitHub OAuth staging application

Open https://github.com/settings/developers → OAuth Apps.

Create a **new GitHub OAuth App for Cloudflare staging** (recommended).
Use:
- Application name: \`Design Engineer Cloudflare Staging\`
- Homepage URL: \`https://YOUR-WORKER-URL\`
- Authorization callback URL:
  \`https://YOUR-WORKER-URL/auth/github/callback\`

Copy the new Client ID and Client Secret to the **backend .env**.
Restart the backend container if you edited .env.
Keep your production OAuth app and its callback unchanged.

GitHub callback requests go to Cloudflare Worker → tunnel → local Express
backend, where the existing OAuth state and token exchange run.

## Step 9 — Update development Supabase Google login redirects

Open your **development** Supabase project → Authentication → URL Configuration.

Add a Redirect URL:
\`https://YOUR-WORKER-URL/auth/google/callback/**\`

Keep your existing localhost URL if you still need local development.
You may set Site URL to your Worker hostname for this separate staging
environment, but the backend uses an explicit redirectTo.
In Supabase → Authentication → Providers → Google, the Google provider
Client ID and Client Secret stay as already configured for development.

**Google Cloud Console Authorized redirect URI remains the Supabase URL:**
\`https://YOUR-DEV-PROJECT.supabase.co/auth/v1/callback\`
— NOT the Worker URL. If the development Supabase project has already been
added to your Google OAuth client, **no further Google Cloud change** is needed.

## Step 10 — Point your Figma DEVELOPMENT plugin at the Worker

Do NOT edit your production Figma plugin or publish an update yet.
The new branch adds a public **build-time** frontend variable,
\`DESIGN_ENGINEER_API_URL\`, so you do not need to edit TypeScript source.

In PowerShell at repository root (a **new terminal**):

\`\`\`powershell
cd design-engineer-plugin
$env:DESIGN_ENGINEER_API_URL = "https://YOUR-WORKER-URL"
npm ci
npm run watch
\`\`\`

The development Figma \`manifest.json\` permits
\`https://*.workers.dev\` under \`devAllowedDomains\`.
Import/reload the development plugin from its manifest in Figma Desktop.
The existing \`http://localhost:4000\` default still applies if
\`DESIGN_ENGINEER_API_URL\` is not set when the plugin is built.

**Never put API keys, Supabase service keys, GitHub secrets or gateway shared
secrets in \`DESIGN_ENGINEER_API_URL\`**; it is only a public HTTPS hostname.

## Step 11 — End-to-end staging verification

1. Load \`/__edge/health\` and \`/healthz\`.
2. Test Supabase email and Google login.
3. Connect GitHub with the new staging OAuth app.
4. Choose a project, test GitHub repo/branch, stack and AI Agent.
5. Test one small Figma frame: extract context → review plan → approve.
6. Start with Direct API Gemini, using a test key and a disposable GitHub repo.
7. Test Codex CLI, Claude Code CLI, and OpenCode CLI **only while the Docker
   backend is running**. CLI runs are NOT hosted by Workers Free.
8. Verify the generated GitHub PR, then inspect Docker logs.
9. Restart cloudflared only if needed; update \`BACKEND_ORIGIN\` if it
   gets a new URL.

## What changes for a real production launch?

**This free setup is NOT a complete production migration.**
To use Design Engineer without leaving your PC online, you need a
separately hosted backend with filesystem/Git/CLI capabilities, or a paid
Cloudflare Containers deployment. Additional production engineering includes
durable queues, per-job isolation, restart-safe OAuth state, async progress,
cancellation, limits on model spend and code execution, rate limiting,
secrets rotation, security review, and persistence for interrupted jobs.
Avoid routing existing users to this staging Worker.

## Official references

- Workers Free limits: https://developers.cloudflare.com/workers/platform/limits/
- Containers billing: https://developers.cloudflare.com/containers/platform/pricing/
- Quick Tunnels: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
- Wrangler secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Worker routing: https://developers.cloudflare.com/workers/configuration/routing/
- Figma network access: https://developers.figma.com/docs/plugins/manifest/
