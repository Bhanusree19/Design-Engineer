-- Deployment 13: fidelity check. Apply AFTER 012_recurring_subscriptions.sql. Additive only.
--  * design_contexts.reference_png: the Figma export of the frame (base64 PNG),
--    kept beside the context so the coding agent never reads it. The build's
--    fidelity check compares the rendered screen with it.
--  * design_contexts.reference_scale: the export scale (1 unless the frame is
--    very large).
-- The fidelity result itself lives in implementation_jobs.result.fidelity
-- (jsonb), so no job table change is needed. Safe to run more than once.
begin;

alter table public.design_contexts add column if not exists reference_png text;
alter table public.design_contexts add column if not exists reference_scale real;

comment on column public.design_contexts.reference_png is
  'Figma PNG export of the frame (base64) used by the build fidelity check. Never sent to the coding agent.';

commit;
