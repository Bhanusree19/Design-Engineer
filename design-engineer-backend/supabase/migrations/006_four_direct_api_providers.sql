-- Deployment 04: extend Direct API support to four providers.
-- Apply ONLY to a development Supabase database, AFTER migrations 004 and 005.
-- Existing CLI jobs/projects and legacy Gemini Direct API projects remain valid.
BEGIN;
ALTER TABLE public.projects
 DROP CONSTRAINT IF EXISTS projects_coding_agent_check;
ALTER TABLE public.projects
 ADD CONSTRAINT projects_coding_agent_check
 CHECK (coding_agent IN ('codex','claude','opencode','gemini-api','direct-api'));
ALTER TABLE public.projects
 DROP CONSTRAINT IF EXISTS projects_execution_mode_check;
ALTER TABLE public.projects
 ADD CONSTRAINT projects_execution_mode_check CHECK (
   (coding_agent IN ('codex','claude','opencode') AND execution_mode='cli')
   OR (coding_agent='gemini-api' AND execution_mode='direct-api' AND model_provider='gemini')
   OR (coding_agent='direct-api' AND execution_mode='direct-api'
       AND model_provider IN ('gemini','deepseek','openai','anthropic'))
 );
-- model_connections.provider already permits all four provider IDs from 004/005;
-- no additional credential table or plaintext columns are needed.
-- implementation_jobs.execution_mode already exists from migration 005.
COMMIT;
