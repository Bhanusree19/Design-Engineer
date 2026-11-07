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
