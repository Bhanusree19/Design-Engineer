-- Deployment 04 Gemini Direct API (run AFTER 004_multi_agent.sql).
-- Additive and backward-compatible. Do not apply to production before staging testing.
BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'cli';

-- Existing Codex/Claude/OpenCode records retain their defaults and values.
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_coding_agent_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_coding_agent_check
  CHECK (coding_agent IN ('codex','claude','opencode','gemini-api'));

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_model_provider_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_model_provider_check
  CHECK (model_provider IN ('openai','anthropic','opencode','ollama-cloud','deepseek','moonshotai','gemini'));

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_execution_mode_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_execution_mode_check
  CHECK (
    (coding_agent = 'gemini-api' AND execution_mode = 'direct-api' AND model_provider = 'gemini')
    OR
    (coding_agent IN ('codex','claude','opencode') AND execution_mode = 'cli')
  );

-- Credential records stay encrypted and scoped to user_id; no new plaintext fields.
-- Expand the existing provider allowlist. If your staging database has a
-- custom provider CHECK constraint, review that constraint before applying.
ALTER TABLE public.model_connections
  DROP CONSTRAINT IF EXISTS model_connections_provider_check;
ALTER TABLE public.model_connections
  ADD CONSTRAINT model_connections_provider_check
  CHECK (provider IN ('anthropic','opencode','ollama-cloud','deepseek','moonshotai','openai','gemini'));

ALTER TABLE public.implementation_jobs
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'cli';
ALTER TABLE public.implementation_jobs
  DROP CONSTRAINT IF EXISTS implementation_jobs_execution_mode_check;
ALTER TABLE public.implementation_jobs
  ADD CONSTRAINT implementation_jobs_execution_mode_check
  CHECK (execution_mode IN ('cli','direct-api'));

COMMIT;
