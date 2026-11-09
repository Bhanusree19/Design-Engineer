## Gemini JSON generation resilience (local test fix)

Local Gemini testing previously failed after cloning with
`INVALID_CODE_RESPONSE: Gemini returned invalid JSON for file edits`.
The Direct API workspace editor now retries malformed or truncated responses up
to **three total generation requests**, with progressively smaller repository
context. Only complete JSON responses with valid file paths are ever written.
Each retry may consume API quota.

Gemini generation now includes a structured `responseJsonSchema`, a larger
response token allowance, Gemini 3 low-thinking configuration, and safe
`finishReason` handling (including `MAX_TOKENS` vs safety blocks).
Docker logs show only the provider, model, failure category and attempt number;
they do **not** include raw model output, source code, prompts, or API keys.

**Local retest (Windows PowerShell, repository root):**

```powershell
git switch design-engineer-deployment-04-cloudflare-agents
git pull origin design-engineer-deployment-04-cloudflare-agents
docker build -f Dockerfile.cloudflare -t design-engineer-v04 .
docker stop design-engineer-v04
docker rm design-engineer-v04
docker run --rm --name design-engineer-v04 -p 4000:4000 --env-file design-engineer-backend/.env design-engineer-v04
```

If `docker rm` reports the container no longer exists after stop, ignore that
line. Test a single small Figma frame first, then inspect the generated GitHub
PR. Retry exhaustion returns a clear message recommending a smaller Figma
selection or a model with more output capacity. This is not a guarantee that
every large Figma screen can be generated in one request; later work should
generate bounded individual file batches and run builds/tests in isolated jobs.

# Deployment 04 — multi-agent development branch

**Source:** `design-engineer-deployment-03` (unchanged).
**Working branch:** `design-engineer-deployment-04-cloudflare-agents`.
**Status:** Developer preview. Backend and Figma plugin build in CI. Not deployed.

## Authentication verification update (Deployment 04)
- The Agent Selection Continue button now verifies access before saving a provider key or updating project settings.
- Anthropic API credentials are checked against the official model-list endpoint and then Claude Code is asked for a tiny actual response.
- OpenCode models are tested via a short, explicit model invocation with an isolated process HOME.
- The provider API key is encrypted only after successful verification; existing saved keys are rechecked when reused.
- OpenCode account keys can be entered for free-tier models that require sign-in.
- Error codes distinguish invalid key, billing unavailable, provider rate limit, unknown model, timeout and missing CLI.
- Each verification is initiated by the user and may incur a small provider charge. Provider credits and free-model terms can change.

**Validation limitation:** GitHub CI tests the logic with mocked provider requests and checks the plugin build. It does not have paid Anthropic/DeepSeek/Ollama Cloud credentials and does not prove that those providers work live. Production agent probing requires proper execution isolation and rate limiting.

## Four Direct API providers (current Deployment 04 feature)

The Figma agent-selection page offers two **separate execution paths**:

- **Coding CLI agents:** Codex CLI, Claude Code CLI, OpenCode CLI.
- **Direct Model API:** Gemini, DeepSeek, OpenAI, Anthropic only.

Direct API user flow: choose Direct Model API → choose one of four providers →
enter that provider's key (or reuse a saved connection) → load models from the
provider's own API → select a model → Verify Connection & Continue → select
Figma frames → review implementation plan → generate files → GitHub PR.

All four providers share backend adapter \`adapters/direct-api.js\`, which has
an explicit four-provider registry, allowlisted HTTPS hosts, per-provider
authentication headers/response parsing and connection probes.
\`adapters/gemini-api.js\` retains the common bounded repository context,
structured edit generation and protected-file validation for every direct
provider (the module name is historical).
Direct API requests use Node 22 \`fetch\`, not any coding CLI binary.
Implementation still runs in the existing repository workspace and reuses
GitHub clone/commit/push/PR code. It does **not** run tests or perform
multi-turn repair; review PRs before merging.

**Development Supabase migrations (in this exact order):**
1. \`supabase/schema.sql\` only for a fresh development database.
2. \`supabase/migrations/004_multi_agent.sql\`
3. \`supabase/migrations/005_gemini_direct_api.sql\`
4. \`supabase/migrations/006_four_direct_api_providers.sql\`

Projects store \`coding_agent='direct-api'\`, \`execution_mode='direct-api'\`,
\`model_provider\` equal to one of \`gemini/deepseek/openai/anthropic\`, and
the chosen \`model_id\`. Existing CLI projects still have
\`execution_mode='cli'\`; legacy \`gemini-api\` projects also remain supported.
Encrypted credentials are stored in \`model_connections\` keyed by user/provider,
not in projects. The backend verifies keys and models before updating the
project and never sends provider keys back to Figma.

Do not apply this migration to production before backup and staging testing.
CI checks adapter logic with mocks and compiles the Figma plugin; real API
billing/access, Docker staging and GitHub-generated PRs still need local
end-to-end verification. Generated repository code is untrusted; keep it
out of privileged build environments.

## Gemini Direct API (added to Deployment 04)

**User flow:** select **Gemini Direct API** at the agent step, paste a Google AI Studio
Gemini API key (or reuse an existing saved one), click **Load available Gemini models**,
pick a model, then click **Verify connection & Continue**. The backend uses the
official Gemini HTTP API to check available models and request a short verification
response. Only after successful verification is a new key encrypted and stored
in Supabase `model_connections`. The project saves `coding_agent=gemini-api`,
`model_provider=gemini`, `model_id=<selected model>`, and
`execution_mode=direct-api`.

**Implementation flow:** Select Figma frames → Fetch context → Review implementation
plan → Start Implementation → server clones the selected repo → Gemini REST API
receives a bounded snapshot of repository files, Figma context and implementation
prompt → returns structured file edits → server validates paths, rejects symlinks
and secret paths, and applies files → existing GitHub commit/push/PR path executes.

Gemini has no CLI dependency in this mode. Node's built-in `fetch` is used; no
Gemini SDK install or Dockerfile change is required. The existing backend still
needs a writable filesystem and Git to clone/commit/push. This is not an autonomous
multi-step agent; direct API mode uses a single structured edit pass and DOES NOT
run or automatically fix builds/tests. Review the PR and run your project tests.

**Development Supabase migration sequence:**
1. Fresh development Supabase: apply `supabase/schema.sql` first.
2. Apply `supabase/migrations/004_multi_agent.sql`.
3. Apply `supabase/migrations/005_gemini_direct_api.sql`.

Migration 005 is additive: adds `projects.execution_mode` defaulting to `cli`,
extends allowed agents/providers, and adds `implementation_jobs.execution_mode`.
The existing `model_connections` encrypted-credential table is reused for Gemini;
no raw API keys are stored on `projects` and existing Codex/Claude/OpenCode
projects retain `cli` execution mode. Do NOT apply migrations to your production
Supabase database before separate staging validation and a backup.

**Verification limitations:** GitHub CI checks mocked Gemini model API responses,
project TypeScript build and safe file application. Live Google API billing,
model availability, real repo PRs, Cloudflare isolation and production security
are not verified. Do not cut over the published Figma plugin yet.

## Changes already committed

- Codex, Claude Code, and OpenCode adapter dispatch with validated agent/model selection.
- Figma coding-agent and model-provider selection after technology stack selection.
- OpenCode model discovery via authenticated `GET /api/models?provider=...`.
- Provider-key connection endpoint encrypted with server-side AES-GCM.
- Additive Supabase schema migration for agent selections, connections, and job metadata.
- Per-job credential home and per-device Codex login credential homes.
- GitHub access token no longer embedded in repository clone URL.
- Cloudflare Workers -> Containers **staging-only** scaffold.
- CI checks Node backend syntax, adapter tests, and Figma plugin build.

**Not production-ready:** Cloudflare Containers job isolation, secret propagation,
durable queue and background jobs, robust cancellation and retries, model
pricing/compatibility, provider OAuth account-login flows, commercial usage
verification, end-to-end coding-agent tests, and production OAuth cutover.
A successful build does not prove that every provider is authenticated or can
generate a GitHub pull request.

## Local setup (Windows / macOS / Linux)

Prerequisites: Node.js 22+, npm, Git, Docker (optional), Figma desktop,
a **development** Supabase project and GitHub OAuth app.

```bash
git clone https://github.com/Bhanusree19/Design-Engineer.git
cd Design-Engineer
git switch design-engineer-deployment-04-cloudflare-agents

cd design-engineer-backend
npm ci
node --check server.js
node --test tests/adapters.test.js

cd ../design-engineer-plugin
npm ci
npm run build
```

Apply `design-engineer-backend/supabase/migrations/004_multi_agent.sql`
to your development Supabase database using SQL Editor. The migration extends,
rather than destroys, your existing data.

Create `design-engineer-backend/.env` from `.env.example` and set:
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (backend only; never send to Figma)
- `ENCRYPTION_KEY` (64 hex characters, stable across restarts)
- GitHub OAuth client ID/secret
- `BACKEND_URL=http://localhost:4000` for local testing

Use separate development credentials. Configure your GitHub OAuth callback URL
to `http://localhost:4000/auth/github/callback` and the corresponding
Supabase/Google redirect allowlists.

Start local API:
```bash
cd design-engineer-backend
npm start
```

Build plugin:
```bash
cd design-engineer-plugin
npm run watch
```

For local plugin testing, change the DEFAULT_BASE_URL in
`src/api/client.ts` to `http://localhost:4000`, and add
`http://localhost:4000` to the plugin's `manifest.json` allowedDomains.
Keep those local changes out of production commits. Import the manifest into
Figma desktop via Plugins -> Development -> Import from manifest.

### Docker worker staging smoke test
Run at the repository root:
```bash
docker build -f Dockerfile.cloudflare -t design-engineer-agents:dev .
docker run --rm -p 4000:4000 --env-file design-engineer-backend/.env \
  -e BACKEND_URL=http://localhost:4000 design-engineer-agents:dev
```

Check the CLIs:
```bash
docker run --rm design-engineer-agents:dev opencode --version
docker run --rm design-engineer-agents:dev claude --version
```

Note: the Docker build and live model integrations have **not** been verified
by GitHub CI; these commands must be run before real usage.

### Manual Figma test
1. Sign into Design Engineer and connect your development GitHub app.
2. Create a test project, select a disposable repository/branch and stack.
3. Select Codex, Claude Code, or OpenCode. For OpenCode, choose a provider and
   actual discovered model; connection requirements depend on the provider.
4. Select a test Figma frame, Fetch, review implementation plan.
5. Start implementation only in an isolated, controlled test environment.
6. Verify generated GitHub pull request and that no credentials appear in
   changed files, Git history, logs, or repository config.

## Cloudflare staging
`cloudflare/` contains a staging-only Worker/Container entry point. It is not
a functional production migration: job isolation, authentication-state
persistence, secret propagation, and durable background queue are still
required. See `cloudflare/README.md`.

Do not modify the published Figma backend URL, the Render deployment, or the
production Supabase database until a verified staging rollout and rollback
plan are in place.
