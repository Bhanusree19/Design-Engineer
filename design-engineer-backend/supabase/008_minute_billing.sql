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
 ('Plus','plus',100,2999,'INR',true,2,'["100 implementation minutes per 30 days"]'::jsonb),
 ('Studio','studio',200,4999,'INR',true,3,'["200 implementation minutes per 30 days"]'::jsonb)
on conflict (slug) do nothing;

-- Adopt required defaults on existing legacy records once, without resetting
-- later admin edits on subsequent runs of this migration.
update public.plans set build_minutes = case slug
 when 'free' then 40 when 'plus' then 100 when 'studio' then 200
 else build_minutes end
where slug in ('free','plus','studio') and build_minutes=0;
update public.plans set price_inr=2999 where slug='plus' and price_inr in (799,2999);
update public.plans set price_inr=4999 where slug='studio' and price_inr=1699;
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
