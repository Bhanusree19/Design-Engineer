-- Deployment 09: flow revamp. Apply AFTER 010. Additive only: no table or
-- column is dropped, and today's plugin keeps working unchanged.
--  * project_repos: a project can link more than one repository / branch.
--    The project's own repository + base_branch stay the "active" link that
--    plan and implement already read; a trigger keeps project_repos in step
--    with them, so older plugins that only PATCH the project still work.
--  * profiles.ai_agent / ai_provider / ai_model: the AI model chosen per account.
--  * implementation_jobs snapshot of repository, branch and model, so build
--    history stays correct after the project's active link changes.
--  * every started build is charged run time + a 10 second server-start buffer
--    (never more than the reserved seconds). Safe to run more than once.
begin;

create table if not exists public.project_repos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  repository text not null,
  branch text not null,
  app_root text not null default '',
  stack text check (stack is null or stack in ('react-native','react-js')),
  stack_source text check (stack_source is null or stack_source in ('detected','user')),
  repo_context jsonb,
  is_default boolean not null default false,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_repos_unique_link unique (project_id, repository, branch, app_root)
);
create unique index if not exists project_repos_one_default
  on public.project_repos(project_id) where is_default;
create index if not exists project_repos_user_idx on public.project_repos(user_id, project_id);

alter table public.project_repos enable row level security;
revoke all on public.project_repos from anon;
grant select, insert, update, delete on public.project_repos to authenticated;
drop policy if exists project_repos_select_own on public.project_repos;
create policy project_repos_select_own on public.project_repos
  for select to authenticated using (user_id = auth.uid());
drop policy if exists project_repos_insert_own on public.project_repos;
create policy project_repos_insert_own on public.project_repos
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
drop policy if exists project_repos_update_own on public.project_repos;
create policy project_repos_update_own on public.project_repos
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists project_repos_delete_own on public.project_repos;
create policy project_repos_delete_own on public.project_repos
  for delete to authenticated using (user_id = auth.uid());

drop trigger if exists set_project_repos_updated_at on public.project_repos;
create trigger set_project_repos_updated_at before update on public.project_repos
  for each row execute procedure public.set_updated_at();

-- Existing projects: their current repository + branch becomes the default link.
insert into public.project_repos
  (project_id, user_id, repository, branch, stack, stack_source, repo_context, is_default)
select p.id, p.user_id, p.repository, p.base_branch, p.stack, p.stack_source, p.repo_context,
  not exists (select 1 from public.project_repos d where d.project_id = p.id and d.is_default)
from public.projects p
where p.repository is not null and p.repository <> ''
  and p.base_branch is not null and p.base_branch <> ''
on conflict (project_id, repository, branch, app_root) do nothing;

-- Whenever the project's active repository / branch / stack changes (old or
-- new plugin), record it as a link. The first link becomes the default.
create or replace function public.sync_project_repo_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $sync_link$
begin
  if new.repository is null or new.repository = '' or new.base_branch is null or new.base_branch = '' then
    return new;
  end if;
  insert into public.project_repos
    (project_id, user_id, repository, branch, stack, stack_source, repo_context, is_default)
  values (new.id, new.user_id, new.repository, new.base_branch, new.stack, new.stack_source,
    new.repo_context,
    not exists (select 1 from public.project_repos d where d.project_id = new.id and d.is_default))
  on conflict (project_id, repository, branch, app_root) do update
    set stack = excluded.stack,
        stack_source = excluded.stack_source,
        repo_context = coalesce(excluded.repo_context, public.project_repos.repo_context),
        updated_at = now();
  return new;
end;
$sync_link$;
revoke all on function public.sync_project_repo_link() from public, anon, authenticated;

drop trigger if exists sync_project_repo_link on public.projects;
create trigger sync_project_repo_link
  after insert or update of repository, base_branch, stack, stack_source, repo_context
  on public.projects for each row execute procedure public.sync_project_repo_link();

-- The AI model is chosen per account. Null means "not chosen yet".
alter table public.profiles add column if not exists ai_agent text;
alter table public.profiles add column if not exists ai_provider text;
alter table public.profiles add column if not exists ai_model text;
do $profile_model$
begin
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_ai_agent_check') then
    alter table public.profiles add constraint profiles_ai_agent_check
      check (ai_agent is null or ai_agent in ('codex','claude','opencode','gemini-api','direct-api'));
  end if;
end;
$profile_model$;

-- Each build remembers which repository, branch and model it used.
alter table public.implementation_jobs add column if not exists repository text;
alter table public.implementation_jobs add column if not exists base_branch text;
alter table public.implementation_jobs add column if not exists coding_agent text;
alter table public.implementation_jobs add column if not exists model_provider text;
alter table public.implementation_jobs add column if not exists model_id text;
grant select (repository, base_branch, coding_agent, model_provider, model_id)
  on public.implementation_jobs to authenticated;

create or replace function public.snapshot_job_setup()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $snapshot$
declare p jsonb;
begin
  -- to_jsonb keeps this working on databases without the 004 model columns.
  select to_jsonb(x) into p from public.projects x where x.id = new.project_id;
  if p is null then return new; end if;
  new.repository     = coalesce(new.repository, p->>'repository');
  new.base_branch    = coalesce(new.base_branch, p->>'base_branch');
  new.coding_agent   = coalesce(new.coding_agent, p->>'coding_agent');
  new.model_provider = coalesce(new.model_provider, p->>'model_provider');
  new.model_id       = coalesce(new.model_id, p->>'model_id');
  return new;
end;
$snapshot$;
revoke all on function public.snapshot_job_setup() from public, anon, authenticated;

drop trigger if exists snapshot_job_setup on public.implementation_jobs;
create trigger snapshot_job_setup before insert on public.implementation_jobs
  for each row execute procedure public.snapshot_job_setup();

-- Every started build: run time + 10 seconds for starting the server.
create or replace function public.build_start_buffer_seconds()
returns integer language sql immutable as $buffer$ select 10 $buffer$;

create or replace function public.finish_metered_job(
 p_job uuid,p_status text,p_result jsonb default null,p_error text default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.implementation_jobs%rowtype; r public.minute_reservations%rowtype; v_extra int;
begin
 if p_status not in ('completed','failed') then raise exception 'INVALID_FINAL_STATUS'; end if;
 select * into j from public.implementation_jobs where id=p_job for update;
 if not found or j.status in ('completed','failed','cancelled') then return false; end if;
 -- Older pre-deployment-06 jobs may not have a reservation.
 if exists(select 1 from public.minute_reservations where job_id=p_job) then
   perform public.meter_job_seconds(p_job);
   select * into r from public.minute_reservations where job_id=p_job for update;
   -- Only builds that actually started pay the server-start buffer, and never
   -- more than was reserved for them.
   if r.started_at is not null and r.state<>'finished' then
     v_extra=greatest(0,least(public.build_start_buffer_seconds(),r.reserved_seconds-r.billed_seconds));
     if v_extra>0 then
       insert into public.minute_wallets(user_id) values(r.user_id) on conflict do nothing;
       if r.bucket='paid' then
         update public.minute_wallets set paid_used_seconds=paid_used_seconds+v_extra,
           updated_at=now() where user_id=r.user_id;
       else
         update public.minute_wallets set free_used_seconds=free_used_seconds+v_extra,
           updated_at=now() where user_id=r.user_id;
       end if;
       update public.minute_reservations set billed_seconds=billed_seconds+v_extra where job_id=p_job;
     end if;
   end if;
   update public.minute_reservations set state='finished',finished_at=now()
   where job_id=p_job;
 end if;
 update public.implementation_jobs set status=p_status,result=p_result,error=left(p_error,500),
 encrypted_access_token=null,finished_at=now(),updated_at=now() where id=p_job;
 return true;
end;
$$;
revoke all on function public.finish_metered_job(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_metered_job(uuid,text,jsonb,text) to service_role;
revoke all on function public.build_start_buffer_seconds() from public,anon,authenticated;
grant execute on function public.build_start_buffer_seconds() to service_role;

commit;
