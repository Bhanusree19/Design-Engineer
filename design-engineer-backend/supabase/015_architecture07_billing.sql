-- Architecture 07: apply after 014, only with no active reservations.
begin;
do $$ begin
 if exists(select 1 from public.minute_reservations where state<>'finished') then
 raise exception 'Drain active builds before applying architecture 07 billing';
 end if;
end $$;
update public.plans set build_minutes=120,features='["120 implementation minutes per 30 days"]'::jsonb,updated_at=now() where slug='plus';
alter table public.implementation_jobs drop constraint if exists implementation_jobs_status_check;
alter table public.implementation_jobs add constraint implementation_jobs_status_check check(status in ('queued','running','completed','failed','cancelled','out_of_minutes'));
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
 if v_avail<600 then raise exception 'MINUTES_EXHAUSTED'; end if;
 if (select count(*) from public.implementation_jobs where user_id=p_user and status in ('queued','running')) >= case when b->>'plan'='studio' then 2 else 1 end then raise exception 'CONCURRENT_BUILD_LIMIT'; end if;
 if (select count(*) from public.implementation_jobs where user_id=p_user and created_at>=now()-interval '24 hours')>=20 then raise exception 'DAILY_BUILD_LIMIT'; end if;
 if (select count(*) from public.implementation_jobs where user_id=p_user and status='failed' and created_at>=now()-interval '24 hours')>=5 then raise exception 'FAILURE_LIMIT'; end if;
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


-- Defer actual wallet debits until final settlement. Reservations still prevent
-- overspending; failures need no compensating debit or refund.
create or replace function public.meter_job_seconds(p_job uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.minute_reservations%rowtype; elapsed int;
begin
 select * into r from public.minute_reservations where job_id=p_job for update;
 if not found then raise exception 'JOB_RESERVATION_MISSING'; end if;
 if r.state='finished' then return jsonb_build_object('exhausted',false,'finished',true,'billedSeconds',r.billed_seconds); end if;
 elapsed=case when r.started_at is null then 0 else greatest(0,ceil(extract(epoch from(now()-r.started_at)))::int) end;
 return jsonb_build_object('exhausted',elapsed>=r.reserved_seconds,'billedSeconds',least(elapsed,r.reserved_seconds));
end $$;
create or replace function public.finish_metered_job(p_job uuid,p_status text,p_result jsonb default null,p_error text default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.implementation_jobs%rowtype; r public.minute_reservations%rowtype; charge int:=0;
begin
 if p_status not in ('completed','failed','cancelled','out_of_minutes') then raise exception 'INVALID_FINAL_STATUS'; end if;
 select * into j from public.implementation_jobs where id=p_job for update;
 if not found or j.status not in ('queued','running') then return false; end if;
 -- Serialize settlement with renewal and new reservations.
 perform 1 from public.user_subscriptions where user_id=j.user_id for update;
 select * into r from public.minute_reservations where job_id=p_job for update;
 if found and r.state<>'finished' then
   if p_status<>'failed' and r.started_at is not null then
     charge=least(r.reserved_seconds,greatest(0,ceil(extract(epoch from(now()-r.started_at)))::int)+case when p_status='completed' then public.build_start_buffer_seconds() else 0 end);
     if p_status='out_of_minutes' then charge=r.reserved_seconds; end if;
     insert into public.minute_wallets(user_id) values(r.user_id) on conflict do nothing;
     if r.bucket='paid' then
       update public.minute_wallets set paid_used_seconds=paid_used_seconds+charge,updated_at=now() where user_id=r.user_id;
     else
       update public.minute_wallets set free_used_seconds=free_used_seconds+charge,updated_at=now() where user_id=r.user_id;
     end if;
   end if;
   update public.minute_reservations set billed_seconds=charge,state='finished',finished_at=now() where job_id=p_job;
 end if;
 update public.implementation_jobs set status=p_status,result=p_result,error=left(p_error,500),encrypted_access_token=null,finished_at=now(),updated_at=now() where id=p_job;
 return true;
end $$;
create or replace function public.fail_stale_metered_job(p_job uuid,p_error text)
returns boolean language sql security definer set search_path=public,pg_temp as $$
 select public.finish_metered_job(p_job,'failed',null,p_error)
$$;
revoke all on function public.finish_metered_job(uuid,text,jsonb,text),public.fail_stale_metered_job(uuid,text),public.meter_job_seconds(uuid),public.create_metered_job(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_metered_job(uuid,text,jsonb,text),public.fail_stale_metered_job(uuid,text),public.meter_job_seconds(uuid),public.create_metered_job(uuid,uuid,jsonb,text) to service_role;
commit;
