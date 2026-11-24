-- Deployment 14: keep detailed fidelity reports admin-only.
-- Apply once to the existing Supabase database AFTER deploying the backend
-- that reads job results through an owner-filtered service-role query.
--
-- implementation_jobs.result contains the full fidelity report and screenshots.
-- The Figma plugin API filters this payload according to the verified user's
-- server-side admin identity, but a direct authenticated PostgREST SELECT
-- previously bypassed that filtering. RLS still protected other users' rows.
--
-- This migration removes only direct client access to the result column.
-- It does NOT remove job status, progress timestamps, or billing permissions.
begin;

revoke select (result) on table public.implementation_jobs from authenticated;
revoke select (result) on table public.implementation_jobs from anon;

commit;

-- Verification (run manually in the SQL editor):
-- select grantee, privilege_type, column_name
-- from information_schema.column_privileges
-- where table_schema='public'
--   and table_name='implementation_jobs'
--   and column_name='result'
--   and grantee in ('anon','authenticated');
-- Expected: zero rows. Check separately for any unexpected table-level
-- SELECT grant to PUBLIC, anon or authenticated; column revoke cannot
-- override a broader table-level SELECT grant.
