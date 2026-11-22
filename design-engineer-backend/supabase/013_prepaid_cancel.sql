-- Deployment 13: record cancellation of a prepaid plan at the existing end date.
-- No mandate exists and this operation does not revoke minutes or refund payments.
begin;
create or replace function public.cancel_prepaid_membership(p_user uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $cancel_prepaid$
declare s public.user_subscriptions%rowtype;
begin
 select * into s from public.user_subscriptions where user_id=p_user for update;
 if not found or s.plan_slug not in ('plus','studio') or s.status<>'active'
   or s.expires_at is null or s.expires_at<=now() then
   raise exception 'NO_ACTIVE_PREPAID_PLAN';
 end if;
 if exists(select 1 from public.recurring_subscriptions
  where user_id=p_user and status in ('created','authenticated','active','pending','halted')
   and cancel_at_period_end=false) then
   raise exception 'RECURRING_MANDATE_MUST_BE_CANCELLED_SEPARATELY';
 end if;
 update public.user_subscriptions
 set metadata=jsonb_set(jsonb_set(coalesce(metadata,'{}'::jsonb),
   '{prepaid_cancelled_at}',to_jsonb(now()::text),true),
   '{prepaid_cancelled_period_end}',to_jsonb(s.expires_at::text),true),updated_at=now()
 where user_id=p_user;
 return jsonb_build_object('success',true,'effectiveAt',s.expires_at);
end;
$cancel_prepaid$;
revoke all on function public.cancel_prepaid_membership(uuid) from public,anon,authenticated;
grant execute on function public.cancel_prepaid_membership(uuid) to service_role;
commit;
