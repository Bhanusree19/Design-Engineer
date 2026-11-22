-- Design Engineer schema (Supabase)
-- Run in SQL Editor. Idempotent where possible.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- PROFILES
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep profiles in sync with auth.users on signup (best-effort; signup path also upserts)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- -----------------------------------------------------------------------------
-- PLANS
-- -----------------------------------------------------------------------------

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  slug text unique not null,
  build_minutes integer not null default 0 check(build_minutes >= 0),
  price_inr integer not null default 0 check(price_inr >= 0),
  currency text not null default 'INR',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  features jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only these three plans can be purchased. No project/screen quotas.
insert into public.plans
 (name, slug, build_minutes, price_inr, currency, is_active, sort_order, features)
values
 ('Free','free',40,0,'INR',true,1,'["40 lifetime implementation minutes"]'::jsonb),
 ('Plus','plus',100,799,'INR',true,2,'["100 implementation minutes per 30 days"]'::jsonb),
 ('Studio','studio',200,1699,'INR',true,3,'["200 implementation minutes per 30 days"]'::jsonb)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- -----------------------------------------------------------------------------
-- USER SUBSCRIPTIONS
-- -----------------------------------------------------------------------------

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.plans(id),
  plan_slug text,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

-- Ensure every user has a free subscription
insert into public.user_subscriptions (user_id, plan_id, plan_slug, status)
select u.id, p.id, p.slug, 'active'
from auth.users u
cross join public.plans p
where p.slug = 'free'
  and not exists (select 1 from public.user_subscriptions us where us.user_id = u.id)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- PAYMENTS / ORDERS
-- -----------------------------------------------------------------------------

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.plans(id),
  plan_slug text,
  amount integer not null default 0,
  currency text not null default 'INR',
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_signature text,
  status text not null default 'created',
  receipt text,
  notes jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- PROJECTS
-- -----------------------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  repository text,
  base_branch text,
  stack text check (stack in ('react-native','react-js')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- GITHUB CONNECTIONS (encrypted tokens)
-- -----------------------------------------------------------------------------

create table if not exists public.github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  github_user_id bigint,
  github_username text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

-- -----------------------------------------------------------------------------
-- CODEX ACCOUNTS (encrypted CLI credentials)
-- -----------------------------------------------------------------------------

create table if not exists public.codex_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  codex_user_id text,
  codex_email text,
  auth_type text,
  credential_reference text,
  status text not null default 'active',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

-- -----------------------------------------------------------------------------
-- DESIGN CONTEXTS (fetched screens)
-- -----------------------------------------------------------------------------

create table if not exists public.design_contexts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid,
  screen_name text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, screen_name)
);

-- Ensure user_id column exists (for older schemas)
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema='public' and table_name='design_contexts' and column_name='user_id'
  ) then
    alter table public.design_contexts add column user_id uuid references auth.users(id) on delete cascade;
  end if;
end $$;

-- Backfill user_id on design_contexts if missing (if column exists)
do $$
begin
  if exists (
    select 1 from information_schema.columns 
    where table_schema='public' and table_name='design_contexts' and column_name='user_id'
  ) then
    update public.design_contexts dc
    set user_id = p.user_id
    from public.projects p
    where dc.project_id = p.id and dc.user_id is null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- UPDATED_AT TRIGGERS
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at before update on public.projects for each row execute procedure public.set_updated_at();

drop trigger if exists set_github_updated_at on public.github_connections;
create trigger set_github_updated_at before update on public.github_connections for each row execute procedure public.set_updated_at();

drop trigger if exists set_codex_updated_at on public.codex_accounts;
create trigger set_codex_updated_at before update on public.codex_accounts for each row execute procedure public.set_updated_at();

drop trigger if exists set_design_contexts_updated_at on public.design_contexts;
create trigger set_design_contexts_updated_at before update on public.design_contexts for each row execute procedure public.set_updated_at();

drop trigger if exists set_plans_updated_at on public.plans;
create trigger set_plans_updated_at before update on public.plans for each row execute procedure public.set_updated_at();

drop trigger if exists set_user_subscriptions_updated_at on public.user_subscriptions;
create trigger set_user_subscriptions_updated_at before update on public.user_subscriptions for each row execute procedure public.set_updated_at();

drop trigger if exists set_payments_updated_at on public.payments;
create trigger set_payments_updated_at before update on public.payments for each row execute procedure public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.github_connections enable row level security;
alter table public.codex_accounts enable row level security;
alter table public.design_contexts enable row level security;
alter table public.plans enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.payments enable row level security;

-- Profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- Projects
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects for select using (auth.uid() = user_id);
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = user_id);
drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects for update using (auth.uid() = user_id);
drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = user_id);

-- GitHub
drop policy if exists "github_select_own" on public.github_connections;
create policy "github_select_own" on public.github_connections for select using (auth.uid() = user_id);
drop policy if exists "github_insert_own" on public.github_connections;
create policy "github_insert_own" on public.github_connections for insert with check (auth.uid() = user_id);
drop policy if exists "github_update_own" on public.github_connections;
create policy "github_update_own" on public.github_connections for update using (auth.uid() = user_id);
drop policy if exists "github_delete_own" on public.github_connections;
create policy "github_delete_own" on public.github_connections for delete using (auth.uid() = user_id);

-- Codex
drop policy if exists "codex_select_own" on public.codex_accounts;
create policy "codex_select_own" on public.codex_accounts for select using (auth.uid() = user_id);
drop policy if exists "codex_insert_own" on public.codex_accounts;
create policy "codex_insert_own" on public.codex_accounts for insert with check (auth.uid() = user_id);
drop policy if exists "codex_update_own" on public.codex_accounts;
create policy "codex_update_own" on public.codex_accounts for update using (auth.uid() = user_id);
drop policy if exists "codex_delete_own" on public.codex_accounts;
create policy "codex_delete_own" on public.codex_accounts for delete using (auth.uid() = user_id);

-- Design contexts
drop policy if exists "design_contexts_select_own" on public.design_contexts;
create policy "design_contexts_select_own" on public.design_contexts for select using (auth.uid() = user_id);
drop policy if exists "design_contexts_insert_own" on public.design_contexts;
create policy "design_contexts_insert_own" on public.design_contexts for insert with check (auth.uid() = user_id);
drop policy if exists "design_contexts_update_own" on public.design_contexts;
create policy "design_contexts_update_own" on public.design_contexts for update using (auth.uid() = user_id);
drop policy if exists "design_contexts_delete_own" on public.design_contexts;
create policy "design_contexts_delete_own" on public.design_contexts for delete using (auth.uid() = user_id);

-- Plans are readable by all authenticated users (so UI can fetch and display)
drop policy if exists "plans_select_all" on public.plans;
create policy "plans_select_all" on public.plans for select using (true);

-- Subscriptions
drop policy if exists "subscriptions_select_own" on public.user_subscriptions;
create policy "subscriptions_select_own" on public.user_subscriptions for select using (auth.uid() = user_id);
drop policy if exists "subscriptions_insert_own" on public.user_subscriptions;
create policy "subscriptions_insert_own" on public.user_subscriptions for insert with check (auth.uid() = user_id);
drop policy if exists "subscriptions_update_own" on public.user_subscriptions;
create policy "subscriptions_update_own" on public.user_subscriptions for update using (auth.uid() = user_id);

-- Payments
drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments for select using (auth.uid() = user_id);
drop policy if exists "payments_insert_own" on public.payments;
create policy "payments_insert_own" on public.payments for insert with check (auth.uid() = user_id);
drop policy if exists "payments_update_own" on public.payments;
create policy "payments_update_own" on public.payments for update using (auth.uid() = user_id);

-- DEPLOYMENT 05: new job table (run after previous base schema)
-- Deployment 05: durable, per-user implementation job records.
-- Apply ONLY to the staging Supabase project after prior migrations.
create table if not exists public.implementation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  screens jsonb not null,
  encrypted_access_token text,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  result jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint implementation_jobs_screens_array check (jsonb_typeof(screens) = 'array'),
  constraint implementation_jobs_queued_token check (status <> 'queued' or encrypted_access_token is not null)
);
create index if not exists implementation_jobs_user_created_idx on public.implementation_jobs(user_id, created_at desc);
create index if not exists implementation_jobs_status_created_idx on public.implementation_jobs(status,created_at);
alter table public.implementation_jobs enable row level security;
-- Never expose encrypted bearer tokens through direct client-side table reads.
-- Backend uses PostgREST with the authenticated user JWT, and selects only
-- specific public fields for status responses.
revoke all on public.implementation_jobs from anon;
-- Job creation is backend-only after verifying the Supabase user and project.
revoke insert,update,delete on public.implementation_jobs from authenticated;
revoke select on public.implementation_jobs from authenticated;
grant select (id,user_id,project_id,status,result,error,created_at,updated_at,started_at,finished_at)
  on public.implementation_jobs to authenticated;
drop policy if exists implementation_jobs_select_own on public.implementation_jobs;
create policy implementation_jobs_select_own on public.implementation_jobs
  for select to authenticated using (user_id=auth.uid());
drop policy if exists implementation_jobs_insert_own on public.implementation_jobs;
-- Only the backend's service role can change job status/results.
revoke update,delete on public.implementation_jobs from authenticated;

-- DEPLOYMENT 06: dynamic minute allowance and verified payments
-- Deployment 06: database-owned minute allowances and payment reconciliation.
-- Apply to an existing Deployment 05 Supabase database (base schema + 007 present).
-- Minutes are editable in public.plans; runtime reads the database on EVERY call.
-- Legacy plan quota columns are removed; existing plan UUIDs and subscriptions stay intact.
begin;

-- Convert the legacy plans table in place, retaining UUIDs referenced by
-- user_subscriptions and payments. No screen or project count quotas remain.
alter table public.plans add column if not exists build_minutes integer not null default 0;
alter table public.plans drop column if exists project_limit;
alter table public.plans drop column if exists screen_limit_per_project;

-- Idempotent nonnegative validation.
do $billing_plans$
begin
 if not exists (
   select 1 from pg_constraint
   where conrelid='public.plans'::regclass
     and conname='plans_build_minutes_nonnegative'
 ) then
   alter table public.plans add constraint plans_build_minutes_nonnegative
     check (build_minutes >= 0);
 end if;
end;
$billing_plans$;

-- New customers see only Free, Plus, Studio. Old tiers stay inactive because
-- existing subscriptions or payments may still reference their UUIDs.
insert into public.plans
 (name,slug,build_minutes,price_inr,currency,is_active,sort_order,features)
values
 ('Free','free',40,0,'INR',true,1,'["40 lifetime implementation minutes"]'::jsonb),
 ('Plus','plus',100,799,'INR',true,2,'["100 implementation minutes per 30 days"]'::jsonb),
 ('Studio','studio',200,1699,'INR',true,3,'["200 implementation minutes per 30 days"]'::jsonb)
on conflict (slug) do nothing;

-- Adopt required defaults on existing legacy records once, without resetting
-- later admin edits on subsequent runs of this migration.
update public.plans set build_minutes = case slug
 when 'free' then 40 when 'plus' then 100 when 'studio' then 200
 else build_minutes end
where slug in ('free','plus','studio') and build_minutes=0;
-- Revert only the earlier draft defaults; any other admin-set price is kept.
update public.plans set price_inr=799 where slug='plus' and price_inr=2999;
update public.plans set price_inr=1699 where slug='studio' and price_inr=4999;
update public.plans set price_inr=0 where slug='free' and price_inr<>0;
update public.plans set is_active=(slug in ('free','plus','studio'));
update public.plans set sort_order=case slug
 when 'free' then 1 when 'plus' then 2 when 'studio' then 3
 else sort_order end
where slug in ('free','plus','studio');
update public.plans set features=case slug
 when 'free' then '["40 lifetime implementation minutes"]'::jsonb
 when 'plus' then '["100 implementation minutes per 30 days"]'::jsonb
 when 'studio' then '["200 implementation minutes per 30 days"]'::jsonb
 else features end
where slug in ('free','plus','studio')
 and (features is null or features::text like '%screens%' or features::text like '%projects%');

alter table public.implementation_jobs add column if not exists encrypted_access_token text;
alter table public.implementation_jobs add column if not exists started_at timestamptz;
alter table public.implementation_jobs add column if not exists finished_at timestamptz;
-- Older deployments have mandatory model columns; fresh 007 tables omit them.
do $legacy_job_columns$
begin
 if exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='implementation_jobs' and column_name='coding_agent') then
   alter table public.implementation_jobs alter column coding_agent drop not null;
 end if;
 if exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='implementation_jobs' and column_name='model_provider') then
   alter table public.implementation_jobs alter column model_provider drop not null;
 end if;
end;
$legacy_job_columns$;

create table if not exists public.minute_wallets (
 user_id uuid primary key references auth.users(id) on delete cascade,
 free_used_seconds integer not null default 0 check(free_used_seconds>=0),
 paid_used_seconds integer not null default 0 check(paid_used_seconds>=0),
 updated_at timestamptz not null default now()
);
create table if not exists public.minute_reservations (
 job_id uuid primary key references public.implementation_jobs(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 bucket text not null check(bucket in ('free','paid')),
 reserved_seconds integer not null check(reserved_seconds>0),
 billed_seconds integer not null default 0 check(billed_seconds>=0),
 state text not null default 'reserved' check(state in ('reserved','running','finished')),
 started_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz not null default now(),
 constraint minutes_not_over_reserved check(billed_seconds<=reserved_seconds)
);
create index if not exists minute_reservations_user_state_idx on public.minute_reservations(user_id,state);

alter table public.payments add column if not exists checkout_token_hash text;
alter table public.payments add column if not exists checkout_expires_at timestamptz;
alter table public.payments add column if not exists paid_at timestamptz;
create unique index if not exists payments_razorpay_order_unique on public.payments(razorpay_order_id)
 where razorpay_order_id is not null;
create unique index if not exists payments_razorpay_payment_unique on public.payments(razorpay_payment_id)
 where razorpay_payment_id is not null;
create table if not exists public.billing_webhook_events (
 event_id text primary key,
 event_type text not null,
 received_at timestamptz not null default now()
);

-- Sensitive payments and subscriptions may be read by their owner, but only
-- service-role backed verified payment flows can INSERT/UPDATE/DELETE.
revoke all on public.payments from anon, authenticated;
grant select(user_id,id,plan_slug,amount,currency,status,created_at,paid_at)
 on public.payments to authenticated;
drop policy if exists "payments_insert_own" on public.payments;
drop policy if exists "payments_update_own" on public.payments;
drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments for select
 to authenticated using(auth.uid()=user_id);
revoke all on public.user_subscriptions from anon, authenticated;
grant select(user_id,plan_slug,status,started_at,expires_at,created_at,updated_at)
 on public.user_subscriptions to authenticated;
drop policy if exists "subscriptions_insert_own" on public.user_subscriptions;
drop policy if exists "subscriptions_update_own" on public.user_subscriptions;
drop policy if exists "subscriptions_select_own" on public.user_subscriptions;
create policy "subscriptions_select_own" on public.user_subscriptions for select
 to authenticated using(auth.uid()=user_id);
alter table public.minute_wallets enable row level security;
alter table public.minute_reservations enable row level security;
alter table public.billing_webhook_events enable row level security;
revoke all on public.minute_wallets,public.minute_reservations,public.billing_webhook_events from anon,authenticated;

-- The service role is the only caller of the functions below. SECURITY DEFINER
-- transactions provide a single row lock per user for quota and job dispatch.
create or replace function public.minute_balance(p_user uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.user_subscriptions%rowtype;
  p public.plans%rowtype; w public.minute_wallets%rowtype;
  b text; v_used int; v_reserved int; v_quota int;
begin
 select * into s from public.user_subscriptions where user_id=p_user;
 if not found then
  insert into public.user_subscriptions(user_id,plan_id,plan_slug,status)
  select p_user,id,'free','active' from public.plans where slug='free'
  on conflict(user_id) do nothing;
  select * into s from public.user_subscriptions where user_id=p_user;
 end if;
 insert into public.minute_wallets(user_id) values(p_user) on conflict do nothing;
 select * into w from public.minute_wallets where user_id=p_user;
 if s.status='active' and s.plan_slug in ('plus','studio')
    and s.expires_at>now() then
   b:='paid';
 else b:='free'; end if;
 select * into p from public.plans where slug=case when b='paid' then s.plan_slug else 'free' end;
 v_quota=coalesce(p.build_minutes,0)*60;
 v_used=case when b='paid' then w.paid_used_seconds else w.free_used_seconds end;
 select coalesce(sum(reserved_seconds-billed_seconds),0)::int into v_reserved
  from public.minute_reservations where user_id=p_user and bucket=b and state<>'finished';
 return jsonb_build_object('plan',p.slug,'planName',p.name,'allowanceSeconds',v_quota,
   'usedSeconds',v_used,'remainingSeconds',greatest(0,v_quota-v_used),
   'availableSeconds',greatest(0,v_quota-v_used-v_reserved),
   'reservedSeconds',v_reserved,'priceInr',p.price_inr,
   'expiresAt',case when b='paid' then s.expires_at else null end);
end;
$$;

create or replace function public.create_metered_job(
 p_user uuid,p_project uuid,p_screens jsonb,p_encrypted_token text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.user_subscriptions%rowtype; b jsonb; v_bucket text;
 v_avail int; v_reserve int; v_job uuid;
begin
 -- Lock user subscription row before reading or reserving credits.
 insert into public.user_subscriptions(user_id,plan_id,plan_slug,status)
 select p_user,id,'free','active' from public.plans where slug='free'
 on conflict(user_id) do nothing;
 select * into s from public.user_subscriptions where user_id=p_user for update;
 if not exists(select 1 from public.projects where id=p_project and user_id=p_user) then
  raise exception 'PROJECT_NOT_OWNED';
 end if;
 if jsonb_typeof(p_screens)<>'array' or jsonb_array_length(p_screens)=0
    or length(coalesce(p_encrypted_token,''))<30 then
  raise exception 'INVALID_JOB';
 end if;
 b=public.minute_balance(p_user);
 v_avail=(b->>'availableSeconds')::int;
 if v_avail<60 then raise exception 'MINUTES_EXHAUSTED'; end if;
 v_bucket=case when b->>'plan'='free' then 'free' else 'paid' end;
 -- One implementation reserves at most fifteen minutes. Unused time is
 -- released on completion; all active reservations prevent double spending.
 v_reserve=least(900,v_avail);
 v_job=gen_random_uuid();
 insert into public.implementation_jobs(id,user_id,project_id,screens,encrypted_access_token,status)
 values(v_job,p_user,p_project,p_screens,p_encrypted_token,'queued');
 insert into public.minute_reservations(job_id,user_id,bucket,reserved_seconds)
 values(v_job,p_user,v_bucket,v_reserve);
 return v_job;
end;
$$;

create or replace function public.claim_metered_job(p_job uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.implementation_jobs%rowtype;
begin
 select * into j from public.implementation_jobs where id=p_job for update;
 if not found or j.status<>'queued' then return null; end if;
 if not exists(select 1 from public.minute_reservations where job_id=p_job and state='reserved')
 then
   update public.implementation_jobs set status='failed',
     error='This job predates minute billing. Please approve a fresh job.',
     encrypted_access_token=null,finished_at=now() where id=p_job;
   return null;
 end if;
 update public.implementation_jobs set status='running',started_at=now(),
 updated_at=now() where id=p_job;
 update public.minute_reservations set state='running',started_at=now() where job_id=p_job;
 return jsonb_build_object('id',j.id,'user_id',j.user_id,'project_id',j.project_id,
  'screens',j.screens,'encrypted_access_token',j.encrypted_access_token);
end;
$$;

-- Called every 5 seconds while a job runs and once during completion. Bills
-- monotonic wall-clock seconds and refuses to bill more than reserved.
create or replace function public.meter_job_seconds(p_job uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.minute_reservations%rowtype; w public.minute_wallets%rowtype;
 v_bill int; v_delta int; v_bal jsonb;
begin
 select * into r from public.minute_reservations where job_id=p_job for update;
 if not found then raise exception 'JOB_RESERVATION_MISSING'; end if;
 if r.state='finished' then return jsonb_build_object('exhausted',false,'billedSeconds',r.billed_seconds); end if;
 if r.state='reserved' then return jsonb_build_object('exhausted',false,'billedSeconds',0); end if;
 v_bill=least(r.reserved_seconds,greatest(r.billed_seconds,
  ceil(extract(epoch from(now()-r.started_at)))::int));
 v_delta=v_bill-r.billed_seconds;
 insert into public.minute_wallets(user_id) values(r.user_id) on conflict do nothing;
 if v_delta>0 then
  if r.bucket='paid' then
   update public.minute_wallets set paid_used_seconds=paid_used_seconds+v_delta,
     updated_at=now() where user_id=r.user_id;
  else
   update public.minute_wallets set free_used_seconds=free_used_seconds+v_delta,
     updated_at=now() where user_id=r.user_id;
  end if;
  update public.minute_reservations set billed_seconds=v_bill where job_id=p_job;
 end if;
 v_bal=public.minute_balance(r.user_id);
 return jsonb_build_object('exhausted',
  v_bill>=r.reserved_seconds or (v_bal->>'remainingSeconds')::int<=0,
  'billedSeconds',v_bill,'balance',v_bal);
end;
$$;

create or replace function public.finish_metered_job(
 p_job uuid,p_status text,p_result jsonb default null,p_error text default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.implementation_jobs%rowtype;
begin
 if p_status not in ('completed','failed') then raise exception 'INVALID_FINAL_STATUS'; end if;
 select * into j from public.implementation_jobs where id=p_job for update;
 if not found or j.status in ('completed','failed','cancelled') then return false; end if;
 -- Older pre-deployment-06 jobs may not have a reservation.
 if exists(select 1 from public.minute_reservations where job_id=p_job) then
   perform public.meter_job_seconds(p_job);
   update public.minute_reservations set state='finished',finished_at=now()
   where job_id=p_job;
 end if;
 update public.implementation_jobs set status=p_status,result=p_result,error=left(p_error,500),
 encrypted_access_token=null,finished_at=now(),updated_at=now() where id=p_job;
 return true;
end;
$$;

-- Stale-job recovery must not bill all the idle time between a crash
-- and the next scheduled cleanup. Heartbeats have already charged used seconds.
create or replace function public.fail_stale_metered_job(p_job uuid,p_error text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $stale_job$
declare j public.implementation_jobs%rowtype;
begin
 select * into j from public.implementation_jobs where id=p_job for update;
 if not found or j.status not in ('queued','running') then return false; end if;
 update public.minute_reservations set state='finished',finished_at=now()
 where job_id=p_job and state<>'finished';
 update public.implementation_jobs set status='failed',result=null,
   error=left(p_error,500),encrypted_access_token=null,
   finished_at=now(),updated_at=now() where id=p_job;
 return true;
end;
$stale_job$;

-- Idempotent entitlement grant only after payment has been verified by backend
-- against Razorpay order/payment APIs. The DB locks payment + subscription.
create or replace function public.grant_verified_payment(
 p_order text,p_payment text,p_signature text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare pay public.payments%rowtype; v_sub public.user_subscriptions%rowtype;
begin
 select * into pay from public.payments where razorpay_order_id=p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if pay.status='paid' then return pay.razorpay_payment_id=p_payment; end if;
 if pay.status<>'created' then raise exception 'INVALID_PAYMENT_STATE'; end if;
 insert into public.user_subscriptions(user_id,plan_id,plan_slug,status)
 values(pay.user_id,(select id from public.plans where slug='free'),'free','active')
 on conflict(user_id) do nothing;
 select * into v_sub from public.user_subscriptions where user_id=pay.user_id for update;
 update public.payments set status='paid',razorpay_payment_id=p_payment,
  razorpay_signature=p_signature,paid_at=now(),checkout_token_hash=null,updated_at=now()
 where id=pay.id;
 insert into public.minute_wallets(user_id) values(pay.user_id) on conflict do nothing;
 -- Renewal starts a new 30-day period and clears the previous paid allowance.
 -- All reservations from the previous cycle must remain accounted for.
 -- Finished rows are retained as the audit trail.
 update public.minute_wallets set paid_used_seconds=0,updated_at=now() where user_id=pay.user_id;
 update public.user_subscriptions set plan_id=pay.plan_id,plan_slug=pay.plan_slug,
   status='active',started_at=now(),expires_at=now()+interval '30 days',updated_at=now()
 where user_id=pay.user_id;
 return true;
end;
$$;

-- Prevent untrusted authenticated clients from executing any privileged function.
revoke all on function public.minute_balance(uuid) from public,anon,authenticated;
revoke all on function public.create_metered_job(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.claim_metered_job(uuid) from public,anon,authenticated;
revoke all on function public.meter_job_seconds(uuid) from public,anon,authenticated;
revoke all on function public.finish_metered_job(uuid,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.grant_verified_payment(text,text,text) from public,anon,authenticated;
revoke all on function public.fail_stale_metered_job(uuid,text) from public,anon,authenticated;
grant execute on function public.minute_balance(uuid) to service_role;
grant execute on function public.create_metered_job(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.claim_metered_job(uuid) to service_role;
grant execute on function public.meter_job_seconds(uuid) to service_role;
grant execute on function public.finish_metered_job(uuid,text,jsonb,text) to service_role;
grant execute on function public.grant_verified_payment(text,text,text) to service_role;
grant execute on function public.fail_stale_metered_job(uuid,text) to service_role;
commit;

-- DEPLOYMENT 06b: build-minute renewal, refund and history fixes
-- Deployment 06b: build-minute billing fixes. Apply AFTER 008_minute_billing.sql.
-- Billing stays minute-based: every build is charged its real execution
-- seconds against the plan's build_minutes. This migration only fixes:
--  1. Renewing or switching plan before expiry no longer wipes unused minutes
--     or unused days (unused paid seconds carry into the new 30-day period).
--  2. Full refunds revoke the paid period they bought, including for
--     returning customers with older paid months.
--  3. A per-user usage history (builds + payments) for the Figma dashboard.
-- Safe to run more than once.
begin;

alter table public.minute_wallets add column if not exists paid_carryover_seconds integer not null default 0;
do $wallet_carryover$
begin
 if not exists (
   select 1 from pg_constraint
   where conrelid='public.minute_wallets'::regclass
     and conname='minute_wallets_carryover_nonnegative'
 ) then
   alter table public.minute_wallets add constraint minute_wallets_carryover_nonnegative
     check (paid_carryover_seconds >= 0);
 end if;
end;
$wallet_carryover$;

-- Which verified payment bought the current paid period (used by refunds).
alter table public.user_subscriptions add column if not exists current_payment_id uuid
 references public.payments(id) on delete set null;

-- Launch prices: Plus ₹799, Studio ₹1,699. Only replaces the earlier draft
-- defaults (₹2,999 / ₹4,999), so a price an admin set later is kept.
update public.plans set price_inr=799,updated_at=now() where slug='plus' and price_inr=2999;
update public.plans set price_inr=1699,updated_at=now() where slug='studio' and price_inr=4999;

create index if not exists minute_reservations_user_created_idx
 on public.minute_reservations(user_id,created_at desc);

-- Paid allowance = current plan build_minutes (still editable live in
-- public.plans) + seconds carried over from an early renewal.
create or replace function public.minute_balance(p_user uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $balance$
declare s public.user_subscriptions%rowtype;
  p public.plans%rowtype; w public.minute_wallets%rowtype;
  b text; v_used int; v_reserved int; v_quota int; v_carry int;
begin
 select * into s from public.user_subscriptions where user_id=p_user;
 if not found then
  insert into public.user_subscriptions(user_id,plan_id,plan_slug,status)
  select p_user,id,'free','active' from public.plans where slug='free'
  on conflict(user_id) do nothing;
  select * into s from public.user_subscriptions where user_id=p_user;
 end if;
 insert into public.minute_wallets(user_id) values(p_user) on conflict do nothing;
 select * into w from public.minute_wallets where user_id=p_user;
 if s.status='active' and s.plan_slug in ('plus','studio')
    and s.expires_at>now() then
   b:='paid';
 else b:='free'; end if;
 select * into p from public.plans where slug=case when b='paid' then s.plan_slug else 'free' end;
 v_carry=case when b='paid' then w.paid_carryover_seconds else 0 end;
 v_quota=coalesce(p.build_minutes,0)*60+v_carry;
 v_used=case when b='paid' then w.paid_used_seconds else w.free_used_seconds end;
 select coalesce(sum(reserved_seconds-billed_seconds),0)::int into v_reserved
  from public.minute_reservations where user_id=p_user and bucket=b and state<>'finished';
 return jsonb_build_object('plan',p.slug,'planName',p.name,'allowanceSeconds',v_quota,
   'planSeconds',coalesce(p.build_minutes,0)*60,'carryoverSeconds',v_carry,
   'usedSeconds',v_used,'remainingSeconds',greatest(0,v_quota-v_used),
   'availableSeconds',greatest(0,v_quota-v_used-v_reserved),
   'reservedSeconds',v_reserved,'priceInr',p.price_inr,
   'expiresAt',case when b='paid' then s.expires_at else null end);
end;
$balance$;

-- Idempotent entitlement grant after backend verification with Razorpay.
-- Same plan, still active  -> +30 days from the current end date, unused
--                             minutes carried over.
-- Plan switch, still active -> new 30 days from now, unused minutes carried.
-- No active paid period     -> fresh 30 days from now, no carry-over.
create or replace function public.grant_verified_payment(
 p_order text,p_payment text,p_signature text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $grant$
declare pay public.payments%rowtype; v_sub public.user_subscriptions%rowtype;
 w public.minute_wallets%rowtype; v_active boolean; v_old_quota int;
 v_carry int:=0; v_expires timestamptz;
begin
 select * into pay from public.payments where razorpay_order_id=p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if pay.status='paid' then return pay.razorpay_payment_id=p_payment; end if;
 if pay.status<>'created' then raise exception 'INVALID_PAYMENT_STATE'; end if;
 insert into public.user_subscriptions(user_id,plan_id,plan_slug,status)
 values(pay.user_id,(select id from public.plans where slug='free'),'free','active')
 on conflict(user_id) do nothing;
 select * into v_sub from public.user_subscriptions where user_id=pay.user_id for update;
 insert into public.minute_wallets(user_id) values(pay.user_id) on conflict do nothing;
 select * into w from public.minute_wallets where user_id=pay.user_id for update;
 v_active:=v_sub.status='active' and v_sub.plan_slug in ('plus','studio')
   and v_sub.expires_at>now();
 if v_active then
   select coalesce(build_minutes,0)*60 into v_old_quota
     from public.plans where slug=v_sub.plan_slug;
   -- Seconds still reserved by in-flight jobs are included here; those jobs
   -- keep billing into the new period, so nothing is counted twice.
   v_carry:=greatest(0,coalesce(v_old_quota,0)+w.paid_carryover_seconds-w.paid_used_seconds);
   v_expires:=case when v_sub.plan_slug=pay.plan_slug then v_sub.expires_at else now() end
     + interval '30 days';
 else
   v_expires:=now()+interval '30 days';
 end if;
 update public.payments set status='paid',razorpay_payment_id=p_payment,
  razorpay_signature=p_signature,paid_at=now(),checkout_token_hash=null,updated_at=now()
 where id=pay.id;
 update public.minute_wallets set paid_used_seconds=0,paid_carryover_seconds=v_carry,
   updated_at=now() where user_id=pay.user_id;
 update public.user_subscriptions set plan_id=pay.plan_id,plan_slug=pay.plan_slug,
   status='active',started_at=now(),expires_at=v_expires,current_payment_id=pay.id,
   updated_at=now()
 where user_id=pay.user_id;
 return true;
end;
$grant$;

-- Full refund of a verified payment. If it paid for the user's current
-- period, that period ends immediately and falls back to the free trial.
-- Partial refunds change nothing here (reconcile manually).
create or replace function public.revoke_refunded_payment(
 p_order text,p_payment text,p_refunded_amount integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $refund$
declare pay public.payments%rowtype; v_sub public.user_subscriptions%rowtype;
 v_current uuid;
begin
 select * into pay from public.payments
  where razorpay_order_id=p_order and razorpay_payment_id=p_payment for update;
 if not found or pay.status<>'paid' then return false; end if;
 if coalesce(p_refunded_amount,0)<pay.amount then return false; end if;
 select * into v_sub from public.user_subscriptions where user_id=pay.user_id for update;
 v_current:=v_sub.current_payment_id;
 if v_current is null then
   -- Periods granted before this migration: fall back to the newest paid order.
   select id into v_current from public.payments
    where user_id=pay.user_id and status='paid'
    order by paid_at desc nulls last,created_at desc limit 1;
 end if;
 update public.payments set status='refunded',updated_at=now() where id=pay.id;
 if v_current=pay.id then
   update public.user_subscriptions set status='expired',expires_at=now(),
     current_payment_id=null,updated_at=now()
    where user_id=pay.user_id;
   update public.minute_wallets set paid_carryover_seconds=0,updated_at=now()
    where user_id=pay.user_id;
 end if;
 return true;
end;
$refund$;

-- Read-only usage history for the signed-in user's dashboard.
create or replace function public.billing_history(p_user uuid,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $history$
declare v_limit int:=least(greatest(coalesce(p_limit,20),1),50);
 v_builds jsonb; v_payments jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(x) order by x."createdAt" desc),'[]'::jsonb) into v_builds
 from (
  select r.job_id as "jobId",pr.name as "projectName",j.status,r.bucket,
    r.billed_seconds as "billedSeconds",r.state as "meterState",
    case when jsonb_typeof(j.screens)='array' then jsonb_array_length(j.screens) else 0 end as "screenCount",
    r.created_at as "createdAt",r.started_at as "startedAt",r.finished_at as "finishedAt",
    left(j.error,160) as error
  from public.minute_reservations r
  join public.implementation_jobs j on j.id=r.job_id
  left join public.projects pr on pr.id=j.project_id
  where r.user_id=p_user
  order by r.created_at desc limit v_limit
 ) x;
 select coalesce(jsonb_agg(to_jsonb(y) order by y."createdAt" desc),'[]'::jsonb) into v_payments
 from (
  select plan_slug as "planSlug",amount,currency,status,
    created_at as "createdAt",paid_at as "paidAt"
  from public.payments
  where user_id=p_user and status in ('paid','refunded')
  order by created_at desc limit 10
 ) y;
 return jsonb_build_object('builds',v_builds,'payments',v_payments);
end;
$history$;

revoke all on function public.minute_balance(uuid) from public,anon,authenticated;
revoke all on function public.grant_verified_payment(text,text,text) from public,anon,authenticated;
revoke all on function public.revoke_refunded_payment(text,text,integer) from public,anon,authenticated;
revoke all on function public.billing_history(uuid,integer) from public,anon,authenticated;
grant execute on function public.minute_balance(uuid) to service_role;
grant execute on function public.grant_verified_payment(text,text,text) to service_role;
grant execute on function public.revoke_refunded_payment(text,text,integer) to service_role;
grant execute on function public.billing_history(uuid,integer) to service_role;
commit;

-- DEPLOYMENT 07: repository context
-- Deployment 07: repository context. Apply AFTER 009.
-- When a project's repository + branch are chosen, the backend reads the
-- branch and stores what it found (framework, language, styling, components).
-- If an existing React / React Native app is found the stack is set
-- automatically (stack_source = 'detected'); a stack the person picks is
-- recorded as stack_source = 'user'. Safe to run more than once.
begin;
alter table public.projects add column if not exists repo_context jsonb;
alter table public.projects add column if not exists stack_source text;
do $stack_source$
begin
 if not exists (select 1 from pg_constraint
   where conrelid='public.projects'::regclass and conname='projects_stack_source_check') then
   alter table public.projects add constraint projects_stack_source_check
     check (stack_source is null or stack_source in ('detected','user'));
 end if;
end;
$stack_source$;
-- Projects that already had a stack before this feature were chosen by hand.
update public.projects set stack_source='user' where stack is not null and stack_source is null;
commit;

-- DEPLOYMENT 09: flow revamp
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

-- DEPLOYMENT 12: Razorpay recurring subscriptions and expiry
-- Deployment 12: Razorpay recurring mandates and expiry, additive to 011.
begin;
create table if not exists public.recurring_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 plan_slug text not null check(plan_slug in ('plus','studio')),
 amount_paise integer not null check(amount_paise>0),
 currency text not null default 'INR' check(currency='INR'),
 razorpay_subscription_id text not null unique,
 status text not null default 'created' check(status in ('created','authenticated','active','pending','halted','cancelled','completed')),
 cancel_at_period_end boolean not null default false,
 checkout_token_hash text,
 checkout_expires_at timestamptz,
 last_charge_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists recurring_single_pending_authorization
 on public.recurring_subscriptions(user_id) where status='created';
create index if not exists recurring_user_created_idx
 on public.recurring_subscriptions(user_id,created_at desc);
create unique index if not exists recurring_payment_source_unique
 on public.payments(razorpay_payment_id) where razorpay_payment_id is not null;
alter table public.recurring_subscriptions enable row level security;
revoke all on public.recurring_subscriptions from public,anon,authenticated;
-- Only the service-role backend may create mandates or modify their state.

-- Expire database membership status without removing the old plan name from
-- history; minute_balance already returns Free for expired paid memberships.
create or replace function public.expire_paid_membership(p_user uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $expire_paid$
declare v_changed boolean:=false;
begin
 update public.user_subscriptions
 set status='expired',updated_at=now()
 where user_id=p_user and status='active' and plan_slug in ('plus','studio')
   and expires_at is not null and expires_at<=now();
 return found;
end;
$expire_paid$;

-- Called only after the backend verifies the Razorpay webhook HMAC AND
-- independently fetches a captured provider payment for this subscription.
-- The payment ID is a unique idempotency key even if different webhook event
-- IDs report the same payment. Reuse the existing trusted entitlement grant
-- to preserve minute carry-over, reservations, and refund handling.
create or replace function public.apply_recurring_charge(
 p_subscription text,p_payment text,p_amount integer,p_currency text,p_period_end bigint default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $recurring_grant$
declare r public.recurring_subscriptions%rowtype;
 p public.plans%rowtype; v_order text;
begin
 select * into r from public.recurring_subscriptions
 where razorpay_subscription_id=p_subscription for update;
 if not found then
   raise exception 'SUBSCRIPTION_NOT_ACTIVE';
 end if;
 select * into p from public.plans where slug=r.plan_slug;
 if not found or p_currency<>r.currency or p_amount<>r.amount_paise then
   raise exception 'RECURRING_AMOUNT_MISMATCH';
 end if;
 if exists(select 1 from public.payments where razorpay_payment_id=p_payment) then
   return false;
 end if;
 v_order:='recurring_'||p_payment;
 insert into public.payments(user_id,plan_id,plan_slug,amount,currency,
                            razorpay_order_id,status,notes)
 values(r.user_id,p.id,r.plan_slug,p_amount,p_currency,v_order,'created',
        jsonb_build_object('subscription_id',p_subscription));
 perform public.grant_verified_payment(v_order,p_payment,'razorpay-subscription-webhook');
 -- Align entitlement with the paid provider cycle, if Razorpay supplies one.
 if p_period_end is not null and p_period_end between
      extract(epoch from now())::bigint-60 and extract(epoch from now()+interval '45 days')::bigint then
   update public.user_subscriptions
   set expires_at=to_timestamp(p_period_end),updated_at=now()
   where user_id=r.user_id and plan_slug=r.plan_slug;
 end if;
 update public.recurring_subscriptions
 set status=case when status in ('cancelled','completed') then status else 'active' end,
 last_charge_at=now(),updated_at=now()
 where id=r.id;
 return true;
end;
$recurring_grant$;
revoke all on function public.expire_paid_membership(uuid) from public,anon,authenticated;
revoke all on function public.apply_recurring_charge(text,text,integer,text,bigint) from public,anon,authenticated;
grant execute on function public.expire_paid_membership(uuid) to service_role;
grant execute on function public.apply_recurring_charge(text,text,integer,text,bigint) to service_role;
commit;

-- DEPLOYMENT 13: prepaid cancellation preference
-- Deployment 13: record cancellation of a prepaid plan at the existing end date.
-- No mandate exists and this operation does not revoke minutes or refund payments.
begin;
create or replace function public.cancel_prepaid_membership(p_user uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $cancel_prepaid$
declare s public.user_subscriptions%rowtype;
begin
 select * into s from public.user_subscriptions where user_id=p_user for update;
 if not found or s.plan_slug not in ('plus','studio') or s.status<>'active'
   or s.expires_at is null or s.expires_at<=now() then
   raise exception 'NO_ACTIVE_PREPAID_PLAN';
 end if;
 if exists(select 1 from public.recurring_subscriptions
  where user_id=p_user and status in ('created','authenticated','active','pending','halted')
   and cancel_at_period_end=false) then
   raise exception 'RECURRING_MANDATE_MUST_BE_CANCELLED_SEPARATELY';
 end if;
 update public.user_subscriptions
 set metadata=jsonb_set(jsonb_set(coalesce(metadata,'{}'::jsonb),
   '{prepaid_cancelled_at}',to_jsonb(now()::text),true),
   '{prepaid_cancelled_period_end}',to_jsonb(s.expires_at::text),true),updated_at=now()
 where user_id=p_user;
 return jsonb_build_object('success',true,'effectiveAt',s.expires_at);
end;
$cancel_prepaid$;
revoke all on function public.cancel_prepaid_membership(uuid) from public,anon,authenticated;
grant execute on function public.cancel_prepaid_membership(uuid) to service_role;
commit;
