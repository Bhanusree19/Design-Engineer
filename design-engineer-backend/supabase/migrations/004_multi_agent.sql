-- Deployment 04: additive schema; run in Supabase SQL editor BEFORE updated backend.
alter table public.projects add column if not exists coding_agent text not null default 'codex';
alter table public.projects add column if not exists model_provider text not null default 'openai';
alter table public.projects add column if not exists model_id text;
alter table public.projects drop constraint if exists projects_coding_agent_check;
alter table public.projects add constraint projects_coding_agent_check check (coding_agent in ('codex','claude','opencode'));
alter table public.projects drop constraint if exists projects_model_provider_check;
alter table public.projects add constraint projects_model_provider_check check (model_provider in ('openai','anthropic','opencode','ollama','deepseek','moonshotai'));

create table if not exists public.model_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('anthropic','opencode','ollama','deepseek','moonshotai','openai')),
  auth_type text not null default 'api_key',
  encrypted_credential text not null,
  status text not null default 'saved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,provider)
);
alter table public.model_connections enable row level security;
-- Credential records are deliberately unavailable through client RLS;
-- only backend service role access after verifying the Supabase user JWT.
revoke all on public.model_connections from anon, authenticated;

create table if not exists public.implementation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
  coding_agent text not null,
  model_provider text not null,
  model_id text,
  screens jsonb not null default '[]'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.implementation_jobs enable row level security;
revoke all on public.implementation_jobs from anon,authenticated;
create index if not exists implementation_jobs_user_status_idx on public.implementation_jobs(user_id,status,created_at);
