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
