-- Deployment 05: durable, per-user implementation job records.
-- Apply ONLY to the staging Supabase project after prior migrations.
create table if not exists public.implementation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  screens jsonb not null,
  encrypted_access_token text not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  result jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint implementation_jobs_screens_array check (jsonb_typeof(screens) = 'array')
);
create index if not exists implementation_jobs_user_created_idx on public.implementation_jobs(user_id, created_at desc);
create index if not exists implementation_jobs_status_created_idx on public.implementation_jobs(status,created_at);
alter table public.implementation_jobs enable row level security;
-- Never expose encrypted bearer tokens through direct client-side table reads.
-- Backend uses PostgREST with the authenticated user JWT, and selects only
-- specific public fields for status responses.
revoke all on public.implementation_jobs from anon;
grant insert on public.implementation_jobs to authenticated;
revoke select on public.implementation_jobs from authenticated;
grant select (id,user_id,project_id,status,result,error,created_at,updated_at,started_at,finished_at)
  on public.implementation_jobs to authenticated;
drop policy if exists implementation_jobs_select_own on public.implementation_jobs;
create policy implementation_jobs_select_own on public.implementation_jobs
  for select to authenticated using (user_id=auth.uid());
drop policy if exists implementation_jobs_insert_own on public.implementation_jobs;
create policy implementation_jobs_insert_own on public.implementation_jobs
  for insert to authenticated
  with check (user_id=auth.uid() and status='queued' and result is null and error is null);
-- Only the backend's service role can change job status/results.
revoke update,delete on public.implementation_jobs from authenticated;
