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
