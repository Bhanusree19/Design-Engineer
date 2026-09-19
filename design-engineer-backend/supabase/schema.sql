-- =============================================================================
-- Design Engineer — Supabase schema + RLS policies
--
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query) OR via the
-- Supabase CLI. It is idempotent: safe to run again on top of tables you may
-- have already created manually.
--
-- The backend talks to Supabase with the anon / publishable key and the
-- end-user JWT, so every table needs RLS policies that allow a user to read
-- and write only their own rows. This file sets those policies up.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. public.profiles
--    One row per auth user. id = auth.users.id
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. public.projects
--    A Design Engineer project owned by one user.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'active',
  repository  text,
  base_branch text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS repository  text;
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS base_branch text;

-- -----------------------------------------------------------------------------
-- 3. public.github_connections
--    One GitHub connection per user (UNIQUE on user_id).
--    Tokens are encrypted by the backend before they land here.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.github_connections (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  github_user_id         numeric,
  github_username        text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at       timestamptz,
  scopes                 text,
  connected_at           timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 4. public.codex_accounts
--    One active Codex connection per user (UNIQUE on user_id).
--    credential_reference holds backend-encrypted CLI credentials so a login
--    can be restored from the DB instead of only living in a Docker volume.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.codex_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  codex_user_id       text,
  codex_email         text,
  auth_type           text NOT NULL DEFAULT 'codex-cli-device-auth',
  credential_reference text,
  status              text NOT NULL DEFAULT 'active',
  last_verified_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 5. public.design_contexts
--    JSONs saved by Fetch for a project. Implementation reads them from here,
--    so no screen state is kept on the backend disk / in a Docker volume.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.design_contexts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  screen_name text NOT NULL,
  content     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, screen_name)
);

-- -----------------------------------------------------------------------------
-- 6. RLS: enable on every table
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codex_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_contexts    ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 7. RLS policies
-- -----------------------------------------------------------------------------

-- profiles ---------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- projects ----------------------------------------------------------------
DROP POLICY IF EXISTS "projects_select_own" ON public.projects;
CREATE POLICY "projects_select_own" ON public.projects
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "projects_insert_own" ON public.projects;
CREATE POLICY "projects_insert_own" ON public.projects
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "projects_update_own" ON public.projects;
CREATE POLICY "projects_update_own" ON public.projects
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "projects_delete_own" ON public.projects;
CREATE POLICY "projects_delete_own" ON public.projects
  FOR DELETE USING (user_id = auth.uid());

-- github_connections ------------------------------------------------------
DROP POLICY IF EXISTS "github_select_own" ON public.github_connections;
CREATE POLICY "github_select_own" ON public.github_connections
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "github_insert_own" ON public.github_connections;
CREATE POLICY "github_insert_own" ON public.github_connections
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "github_update_own" ON public.github_connections;
CREATE POLICY "github_update_own" ON public.github_connections
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "github_delete_own" ON public.github_connections;
CREATE POLICY "github_delete_own" ON public.github_connections
  FOR DELETE USING (user_id = auth.uid());

-- codex_accounts ----------------------------------------------------------
DROP POLICY IF EXISTS "codex_select_own" ON public.codex_accounts;
CREATE POLICY "codex_select_own" ON public.codex_accounts
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "codex_insert_own" ON public.codex_accounts;
CREATE POLICY "codex_insert_own" ON public.codex_accounts
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "codex_update_own" ON public.codex_accounts;
CREATE POLICY "codex_update_own" ON public.codex_accounts
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "codex_delete_own" ON public.codex_accounts;
CREATE POLICY "codex_delete_own" ON public.codex_accounts
  FOR DELETE USING (user_id = auth.uid());

-- design_contexts ---------------------------------------------------------
DROP POLICY IF EXISTS "contexts_select_own" ON public.design_contexts;
CREATE POLICY "contexts_select_own" ON public.design_contexts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "contexts_insert_own" ON public.design_contexts;
CREATE POLICY "contexts_insert_own" ON public.design_contexts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "contexts_update_own" ON public.design_contexts;
CREATE POLICY "contexts_update_own" ON public.design_contexts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "contexts_delete_own" ON public.design_contexts;
CREATE POLICY "contexts_delete_own" ON public.design_contexts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 8. Auto-create a profile row when an auth user is created
--    (covers sign-ups where email confirmation leaves the user in auth.users
--     before their first sign-in).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 9. Bump updated_at automatically
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','projects','github_connections','codex_accounts','design_contexts']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_set_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
END;
$$;