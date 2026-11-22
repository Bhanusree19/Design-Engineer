-- Deployment 12: Razorpay recurring mandates and expiry, additive to 011.
begin;
create table if not exists public.recurring_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 plan_slug text not null check(plan_slug in ('plus','studio')),
 razorpay_subscription_id text not null unique,
 status text not null default 'created' check(status in ('created','authenticated','active','pending','halted','cancelled','completed')),
 cancel_at_period_end boolean not null default false,
 checkout_token_hash text,
 checkout_expires_at timestamptz,
 last_charge_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists recurring_user_created_idx
 on public.recurring_subscriptions(user_id,created_at desc);
create unique index if not exists recurring_payment_source_unique
 on public.payments(razorpay_payment_id) where razorpay_payment_id is not null;
alter table public.recurring_subscriptions enable row level security;
revoke all on public.recurring_subscriptions from public,anon,authenticated;
-- Only the service-role backend may create mandates or modify their state.

-- Expire database membership status without removing the old plan name from
-- history; minute_balance already returns Free for expired paid memberships.
create or replace function public.expire_paid_membership(p_user uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $expire_paid$
declare v_changed boolean:=false;
begin
 update public.user_subscriptions
 set status='expired',updated_at=now()
 where user_id=p_user and status='active' and plan_slug in ('plus','studio')
   and expires_at is not null and expires_at<=now();
 get diagnostics v_changed = row_count;
 return v_changed;
end;
$expire_paid$;

-- Called only after the backend verifies the Razorpay webhook HMAC AND
-- independently fetches a captured provider payment for this subscription.
-- The payment ID is a unique idempotency key even if different webhook event
-- IDs report the same payment. Reuse the existing trusted entitlement grant
-- to preserve minute carry-over, reservations, and refund handling.
create or replace function public.apply_recurring_charge(
 p_subscription text,p_payment text,p_amount integer,p_currency text,p_period_end bigint default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $recurring_grant$
declare r public.recurring_subscriptions%rowtype;
 p public.plans%rowtype; v_order text;
begin
 select * into r from public.recurring_subscriptions
 where razorpay_subscription_id=p_subscription for update;
 if not found or r.status in ('cancelled','completed') then
   raise exception 'SUBSCRIPTION_NOT_ACTIVE';
 end if;
 select * into p from public.plans where slug=r.plan_slug and is_active=true;
 if not found or p_currency<>'INR' or p_amount<>p.price_inr*100 then
   raise exception 'RECURRING_AMOUNT_MISMATCH';
 end if;
 if exists(select 1 from public.payments where razorpay_payment_id=p_payment) then
   return false;
 end if;
 v_order:='recurring_'||p_payment;
 insert into public.payments(user_id,plan_id,plan_slug,amount,currency,
                            razorpay_order_id,status,notes)
 values(r.user_id,p.id,r.plan_slug,p_amount,p_currency,v_order,'created',
        jsonb_build_object('subscription_id',p_subscription));
 perform public.grant_verified_payment(v_order,p_payment,'razorpay-subscription-webhook');
 -- Align entitlement with the paid provider cycle, if Razorpay supplies one.
 if p_period_end is not null and p_period_end between
      extract(epoch from now())::bigint-60 and extract(epoch from now()+interval '45 days')::bigint then
   update public.user_subscriptions
   set expires_at=greatest(expires_at,to_timestamp(p_period_end)),updated_at=now()
   where user_id=r.user_id and plan_slug=r.plan_slug;
 end if;
 update public.recurring_subscriptions
 set status='active',last_charge_at=now(),checkout_token_hash=null,updated_at=now()
 where id=r.id;
 return true;
end;
$recurring_grant$;
revoke all on function public.expire_paid_membership(uuid) from public,anon,authenticated;
revoke all on function public.apply_recurring_charge(text,text,integer,text,bigint) from public,anon,authenticated;
grant execute on function public.expire_paid_membership(uuid) to service_role;
grant execute on function public.apply_recurring_charge(text,text,integer,text,bigint) to service_role;
commit;
