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
