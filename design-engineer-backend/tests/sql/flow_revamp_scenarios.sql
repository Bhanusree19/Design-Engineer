-- Flow revamp (migration 011) scenarios. Run against a DISPOSABLE database with
-- schema.sql applied (never production):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/flow_revamp_scenarios.sql
-- Everything runs inside a transaction that is rolled back at the end.
begin;

create or replace function pg_temp.check(ok boolean,label text) returns void
language plpgsql as $chk$
begin
 if not coalesce(ok,false) then raise exception 'FAILED: %',label; end if;
 raise notice 'ok - %',label;
end;
$chk$;

create or replace function pg_temp.build(p_user uuid,p_proj uuid,p_secs int,p_status text,p_start boolean)
returns uuid language plpgsql as $b$
declare job uuid;
begin
 job:=public.create_metered_job(p_user,p_proj,'[{"screen":"Home"}]'::jsonb,repeat('x',40));
 if p_start then
  perform public.claim_metered_job(job);
  update public.minute_reservations set started_at=now()-make_interval(secs=>p_secs) where job_id=job;
 end if;
 perform public.finish_metered_job(job,p_status,'{}'::jsonb,null);
 return job;
end;
$b$;

do $scenarios$
declare u uuid:=gen_random_uuid(); proj uuid; proj2 uuid; job uuid; n int; used0 int; used1 int;
  r record; j record;
begin
 insert into auth.users(id) values(u);

 -- Repository links follow the project's active repository
 insert into public.projects(user_id,name,repository,base_branch)
   values(u,'Links','acme/web','main') returning id into proj;
 select count(*) into n from public.project_repos where project_id=proj and is_default
   and repository='acme/web' and branch='main';
 perform pg_temp.check(n=1,'creating a project with a repo makes it the default link');

 update public.projects set stack='react-js',stack_source='detected' where id=proj;
 select * into r from public.project_repos where project_id=proj and branch='main';
 perform pg_temp.check(r.stack='react-js' and r.stack_source='detected','stack is copied onto the link');

 update public.projects set base_branch='develop' where id=proj;
 select * into r from public.project_repos where project_id=proj and branch='develop';
 perform pg_temp.check(r.id is not null and not r.is_default,'switching branch adds a second, non-default link');
 select count(*) into n from public.project_repos where project_id=proj and is_default;
 perform pg_temp.check(n=1,'a project keeps exactly one default link');

 begin
  insert into public.project_repos(project_id,user_id,repository,branch) values(proj,u,'acme/web','main');
  perform pg_temp.check(false,'duplicate link rejected');
 exception when unique_violation then
  perform pg_temp.check(true,'duplicate link rejected');
 end;

 begin
  update public.project_repos set is_default=true where project_id=proj and branch='develop';
  perform pg_temp.check(false,'two default links rejected');
 exception when unique_violation then
  perform pg_temp.check(true,'two default links rejected');
 end;

 insert into public.projects(user_id,name) values(u,'Empty') returning id into proj2;
 select count(*) into n from public.project_repos where project_id=proj2;
 perform pg_temp.check(n=0,'a project without a repository has no links');

 -- Jobs remember which repo / branch they built into
 job:=pg_temp.build(u,proj,30,'completed',true);
 select * into j from public.implementation_jobs where id=job;
 perform pg_temp.check(j.repository='acme/web' and j.base_branch='develop','job snapshots repository and branch');
 update public.projects set base_branch='main' where id=proj;
 select * into j from public.implementation_jobs where id=job;
 perform pg_temp.check(j.base_branch='develop','job keeps its branch after the project changes');

 -- 10 second server-start buffer on every started build
 select billed_seconds into n from public.minute_reservations where job_id=job;
 perform pg_temp.check(n=40,'30 s build is charged 40 s');
 used0:=(public.minute_balance(u)->>'usedSeconds')::int;
 job:=pg_temp.build(u,proj,363,'completed',true);
 select billed_seconds into n from public.minute_reservations where job_id=job;
 used1:=(public.minute_balance(u)->>'usedSeconds')::int;
 perform pg_temp.check(n=373 and used1-used0=373,'363 s build is charged 373 s');

 job:=pg_temp.build(u,proj,180,'failed',true);
 select billed_seconds into n from public.minute_reservations where job_id=job;
 perform pg_temp.check(n=190,'a failed 180 s build is charged 190 s');

 job:=public.create_metered_job(u,proj,'[{"screen":"Home"}]'::jsonb,repeat('x',40));
 perform public.claim_metered_job(job);
 select reserved_seconds into n from public.minute_reservations where job_id=job;
 update public.minute_reservations set started_at=now()-make_interval(secs=>n+500) where job_id=job;
 perform public.finish_metered_job(job,'completed','{}'::jsonb,null);
 select * into r from public.minute_reservations where job_id=job;
 perform pg_temp.check(r.billed_seconds=r.reserved_seconds,'charge never exceeds the reservation');

 used0:=(public.minute_balance(u)->>'usedSeconds')::int;
 job:=pg_temp.build(u,proj,0,'failed',false);
 used1:=(public.minute_balance(u)->>'usedSeconds')::int;
 select billed_seconds into n from public.minute_reservations where job_id=job;
 perform pg_temp.check(n=0 and used1=used0,'a build that never started is not charged');

 job:=pg_temp.build(u,proj,20,'completed',true);
 used0:=(public.minute_balance(u)->>'usedSeconds')::int;
 perform pg_temp.check(not public.finish_metered_job(job,'completed','{}'::jsonb,null)
   and (public.minute_balance(u)->>'usedSeconds')::int=used0,'a second finish adds nothing');

 -- Account model
 update public.profiles set ai_agent='claude',ai_provider='anthropic',ai_model='claude-sonnet' where id=u;
 select count(*) into n from public.profiles where id=u and ai_agent='claude';
 perform pg_temp.check(n=1,'account model is stored on the profile');

 delete from public.projects where id=proj;
 select count(*) into n from public.project_repos where project_id=proj;
 perform pg_temp.check(n=0,'deleting a project removes its links');
end;
$scenarios$;

rollback;
