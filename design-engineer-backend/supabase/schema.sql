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
  project_limit integer not null default 0,
  screen_limit_per_project integer not null default 0,
  price_inr integer not null default 0,
  currency text not null default 'INR',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  features jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed default plans (free, pro, plus, premier)
insert into public.plans (name, slug, project_limit, screen_limit_per_project, price_inr, sort_order, features)
values
  ('Free', 'free', 2, 5, 0, 1, '["2 projects", "5 screens per project"]'::jsonb),
  ('Pro', 'pro', 10, 10, 1000, 2, '["10 projects", "10 screens per project"]'::jsonb),
  ('Plus', 'plus', 50, 20, 2999, 3, '["50 projects", "20 screens per project"]'::jsonb),
  ('Premier', 'premier', 200, 100, 9999, 4, '["200 projects", "100 screens per project"]'::jsonb)
on conflict (slug) do nothing;

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
-- Apply AFTER schema.sql and 007_implementation_jobs.sql on a test Supabase project.
-- Minutes are editable in public.plans; runtime reads the database on EVERY call.
-- Existing columns and records are preserved.
begin;

alter table public.plans add column if not exists build_minutes integer not null default 0;
do $ begin
 if not exists(select 1 from pg_constraint where conname='plans_build_minutes_nonnegative') then
  alter table public.plans add constraint plans_build_minutes_nonnegative check(build_minutes>=0);
 end if;
end $;
-- The price column is in whole INR (Razorpay orders are created in paise).
insert into public.plans(name,slug,project_limit,screen_limit_per_project,price_inr,
  currency,sort_order,features,build_minutes)
values
 ('Studio','studio',200,100,1699,'INR',3,'["200 implementation minutes per 30 days","Bring your own AI model"]',200)
on conflict(slug) do nothing;
update public.plans set build_minutes=case slug
 when 'free' then 40 when 'plus' then 100 when 'studio' then 200
 else build_minutes end
where slug in ('free','plus','studio') and build_minutes=0;
-- Existing Plus price isn't overwritten: edit price_inr in Supabase when ready.
update public.plans set price_inr=799 where slug='plus' and price_inr=2999;
-- Previous Pro / Premier plans are retained in DB but hidden from new checkout.
update public.plans set is_active=false where slug in ('pro','premier');
update public.plans set is_active=true where slug in ('free','plus','studio');

alter table public.implementation_jobs add column if not exists encrypted_access_token text;
alter table public.implementation_jobs add column if not exists started_at timestamptz;
alter table public.implementation_jobs add column if not exists finished_at timestamptz;
alter table public.implementation_jobs alter column coding_agent drop not null;
alter table public.implementation_jobs alter column model_provider drop not null;

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
 if v_avail<1 then raise exception 'MINUTES_EXHAUSTED'; end if;
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
 return jsonb_build_object('exhausted',v_bill>=r.reserved_seconds,
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
 perform public.meter_job_seconds(p_job);
 update public.minute_reservations set state='finished',finished_at=now()
 where job_id=p_job;
 update public.implementation_jobs set status=p_status,result=p_result,error=left(p_error,500),
 encrypted_access_token=null,finished_at=now(),updated_at=now() where id=p_job;
 return true;
end;
$$;

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
grant execute on function public.minute_balance(uuid) to service_role;
grant execute on function public.create_metered_job(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.claim_metered_job(uuid) to service_role;
grant execute on function public.meter_job_seconds(uuid) to service_role;
grant execute on function public.finish_metered_job(uuid,text,jsonb,text) to service_role;
grant execute on function public.grant_verified_payment(text,text,text) to service_role;
commit;
