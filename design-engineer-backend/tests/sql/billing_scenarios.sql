-- Build-minute billing scenarios. Run against a DISPOSABLE database that has
-- schema.sql applied (never production):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/billing_scenarios.sql
-- Everything runs inside a transaction that is rolled back at the end.
begin;

create or replace function pg_temp.check(ok boolean,label text) returns void
language plpgsql as $chk$
begin
 if not coalesce(ok,false) then raise exception 'FAILED: %',label; end if;
 raise notice 'ok - %',label;
end;
$chk$;

create or replace function pg_temp.pay(p_user uuid,p_slug text,p_order text) returns boolean
language plpgsql as $pay$
begin
 insert into public.payments(user_id,plan_id,plan_slug,amount,currency,status,razorpay_order_id)
 select p_user,id,slug,price_inr*100,'INR','created',p_order from public.plans where slug=p_slug;
 return public.grant_verified_payment(p_order,'pay_'||p_order,'sig');
end;
$pay$;

do $scenarios$
declare u uuid:=gen_random_uuid(); proj uuid; job uuid; b jsonb; h jsonb;
  v_exp timestamptz; v_exp2 timestamptz; m jsonb;
begin
 insert into auth.users(id) values(u);
 insert into public.projects(user_id,name) values(u,'Scenario project') returning id into proj;

 -- 1. Free trial
 b:=public.minute_balance(u);
 perform pg_temp.check(b->>'plan'='free' and (b->>'allowanceSeconds')::int=2400,
   'new user gets 40 free build minutes');

 -- 2. A build is charged its real seconds
 job:=public.create_metered_job(u,proj,'[{"screen":"Home"}]'::jsonb,repeat('x',40));
 perform public.claim_metered_job(job);
 update public.minute_reservations set started_at=now()-interval '125 seconds' where job_id=job;
 m:=public.meter_job_seconds(job);
 perform pg_temp.check((m->>'billedSeconds')::int=125,'metering bills elapsed seconds');
 perform public.finish_metered_job(job,'completed','{}'::jsonb,null);
 b:=public.minute_balance(u);
 perform pg_temp.check((b->>'usedSeconds')::int=135 and (b->>'reservedSeconds')::int=0,
   'finished build is charged run time + 10 s server start and releases the rest');

 -- 3. First Plus purchase
 perform pg_temp.check(pg_temp.pay(u,'plus','order_A'),'Plus payment granted');
 b:=public.minute_balance(u);
 perform pg_temp.check(b->>'plan'='plus' and (b->>'allowanceSeconds')::int=6000
   and (b->>'usedSeconds')::int=0,'Plus gives 100 minutes');
 perform pg_temp.check(public.grant_verified_payment('order_A','pay_order_A','sig'),
   'repeat grant (webhook + callback) is idempotent');
 perform pg_temp.check((public.minute_balance(u)->>'allowanceSeconds')::int=6000,
   'repeat grant adds no minutes');

 -- 4. Early renewal keeps unused minutes and days
 update public.minute_wallets set paid_used_seconds=1000 where user_id=u;
 select expires_at into v_exp from public.user_subscriptions where user_id=u;
 perform pg_temp.check(pg_temp.pay(u,'plus','order_B'),'early Plus renewal granted');
 b:=public.minute_balance(u);
 select expires_at into v_exp2 from public.user_subscriptions where user_id=u;
 perform pg_temp.check(v_exp2=v_exp+interval '30 days','early renewal extends from current end date');
 perform pg_temp.check((b->>'carryoverSeconds')::int=5000 and (b->>'allowanceSeconds')::int=11000
   and (b->>'remainingSeconds')::int=11000,'unused 5000 s carried into the renewed period');

 -- 5. Live plan edits still apply to the plan part of the allowance
 update public.plans set build_minutes=120 where slug='plus';
 perform pg_temp.check((public.minute_balance(u)->>'allowanceSeconds')::int=12200,
   'admin edit of build_minutes applies immediately');
 update public.plans set build_minutes=100 where slug='plus';

 -- 6. Upgrade to Studio while active
 update public.minute_wallets set paid_used_seconds=2000 where user_id=u;
 perform pg_temp.check(pg_temp.pay(u,'studio','order_C'),'Studio upgrade granted');
 b:=public.minute_balance(u);
 perform pg_temp.check(b->>'plan'='studio' and (b->>'carryoverSeconds')::int=9000
   and (b->>'allowanceSeconds')::int=21000,'upgrade carries 9000 s on top of 200 minutes');

 -- 7. Refunds
 perform pg_temp.check(not public.revoke_refunded_payment('order_C','pay_order_C',100),
   'partial refund does not revoke');
 perform pg_temp.check(public.revoke_refunded_payment('order_A','pay_order_A',79900),
   'refund of an older month recorded');
 perform pg_temp.check((public.minute_balance(u)->>'plan')='studio',
   'refunding an older month keeps the current period');
 perform pg_temp.check(public.revoke_refunded_payment('order_C','pay_order_C',169900),
   'refund of the current month recorded');
 b:=public.minute_balance(u);
 perform pg_temp.check(b->>'plan'='free' and (b->>'usedSeconds')::int=135,
   'refunding the current month falls back to the remaining free trial');
 perform pg_temp.check(not public.revoke_refunded_payment('order_C','pay_order_C',169900),
   'refund webhook replay is ignored');

 -- 8. Purchase after lapse starts clean (no carry-over)
 perform pg_temp.check(pg_temp.pay(u,'plus','order_D'),'Plus after lapse granted');
 b:=public.minute_balance(u);
 perform pg_temp.check((b->>'carryoverSeconds')::int=0 and (b->>'allowanceSeconds')::int=6000,
   'purchase after lapse has no carry-over');

 -- 9. Usage history
 h:=public.billing_history(u,20);
 perform pg_temp.check(jsonb_array_length(h->'builds')=1
   and (h->'builds'->0->>'billedSeconds')::int=135
   and h->'builds'->0->>'projectName'='Scenario project'
   and (h->'builds'->0->>'screenCount')::int=1,'history lists the build with billed seconds');
 perform pg_temp.check(jsonb_array_length(h->'payments')=4,'history lists paid and refunded payments');
end;
$scenarios$;

rollback;
