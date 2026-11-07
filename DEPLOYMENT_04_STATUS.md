# Deployment 04 — development branch

Base branch: design-engineer-deployment-03 (unchanged).

## Scope
Incremental multi-agent support for Codex, Claude Code and OpenCode.
Provider selection supports OpenCode free models (subject to provider access), Ollama Cloud, DeepSeek, Kimi/Moonshot, OpenAI and Anthropic. Local Ollama is not part of this release.

## Before running
1. Run design-engineer-backend/supabase/migrations/004_multi_agent.sql in a staging Supabase instance.
2. Use Node 22+ and install dependencies in design-engineer-backend/ and design-engineer-plugin/.
3. Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY and a stable 64-digit hex ENCRYPTION_KEY in the backend environment; never commit secrets.
4. Install Claude Code and OpenCode CLIs in the worker runtime. API-key connections are distinct from the Design Engineer sign-in.
5. Run node --test design-engineer-backend/tests/adapters.test.js and npm run build in design-engineer-plugin.

## Important unfinished items
The Cloudflare Workers + Containers migration, durable job queue, CLI installation image, provider model discovery, production-grade per-job container isolation, actual hosted provider integration testing, and OAuth callback cutover require separate implementation and staging verification. Do not direct published Figma traffic to an unverified backend.

Existing Codex auth is retained for backwards compatibility; do not use the legacy shared CODEX_HOME for concurrent users in production.
