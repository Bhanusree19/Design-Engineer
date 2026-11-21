'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sqlDir=path.join(__dirname,'..','supabase');
const migration=fs.readFileSync(path.join(sqlDir,'008_minute_billing.sql'),'utf8');
const schema=fs.readFileSync(path.join(sqlDir,'schema.sql'),'utf8');

test('migration 008 has correctly paired PostgreSQL function and DO delimiters',()=>{
  for(const tag of ['$$','$billing_plans$','$legacy_job_columns$','$stale_job$']){
    const count=migration.split(tag).length-1;
    assert.equal(count%2,0,'Odd number of '+tag+' delimiters');
  }
  assert.doesNotMatch(migration,/\bdo \$ begin\b/i);
  assert.doesNotMatch(migration,/\bas \$\s*\n/i);
  assert.match(migration,/end;\s*\$billing_plans\$;/i);
  assert.match(migration,/end;\s*\$legacy_job_columns\$;/i);
});
test('both migration and fresh schema use ONLY minutes for plan quota',()=>{
  for(const source of [migration,schema]){
    assert.match(source,/build_minutes\s+integer\b/i);
    assert.match(source,/['"]Studio['"],['"]studio['"],200,1699/);
    assert.match(source,/['"]Plus['"],['"]plus['"],100,799/);
    assert.match(source,/drop column if exists project_limit/i);
    assert.match(source,/drop column if exists screen_limit_per_project/i);
    assert.match(source,/function public\.minute_balance/i);
    assert.match(source,/function public\.create_metered_job/i);
    assert.match(source,/function public\.grant_verified_payment/i);
  }
  const base=schema.split('-- USER SUBSCRIPTIONS')[0];
  assert.doesNotMatch(base,/^\s*(project_limit|screen_limit_per_project)\s+/im);
  assert.doesNotMatch(base,/['"]Pro['"],['"]pro['"]/);
  assert.doesNotMatch(base,/['"]Premier['"],['"]premier['"]/);
});
test('fresh schema embeds the exact current migration 008',()=>{
 const marker='-- DEPLOYMENT 06: dynamic minute allowance and verified payments\n';
 assert.ok(schema.includes(marker));
 const next='\n-- DEPLOYMENT 06b: build-minute renewal, refund and history fixes\n';
 assert.equal(schema.split(marker)[1].split(next)[0],migration);
});

const fixes=fs.readFileSync(path.join(sqlDir,'009_minute_billing_fixes.sql'),'utf8');
test('fresh schema embeds the exact current migration 009',()=>{
 const marker='\n-- DEPLOYMENT 06b: build-minute renewal, refund and history fixes\n';
 assert.ok(schema.includes(marker));
 const next='\n-- DEPLOYMENT 07: repository context\n';
 assert.equal(schema.split(marker)[1].split(next)[0],fixes);
});
test('migration 009 keeps minute billing and pairs its delimiters',()=>{
 for(const tag of ['$wallet_carryover$','$balance$','$grant$','$refund$','$history$']){
  assert.equal((fixes.split(tag).length-1)%2,0,'Odd number of '+tag+' delimiters');
 }
 assert.match(fixes,/paid_carryover_seconds/);
 assert.match(fixes,/current_payment_id/);
 assert.match(fixes,/function public\.revoke_refunded_payment/);
 assert.match(fixes,/function public\.billing_history/);
 for(const fn of ['revoke_refunded_payment(text,text,integer)','billing_history(uuid,integer)']){
  assert.ok(fixes.includes('revoke all on function public.'+fn+' from public,anon,authenticated'));
 }
});

const repoCtx=fs.readFileSync(path.join(sqlDir,'010_repo_context.sql'),'utf8');
test('fresh schema embeds the exact current migration 010 (repository context)',()=>{
 const marker='\n-- DEPLOYMENT 07: repository context\n';
 assert.ok(schema.includes(marker));
 assert.equal(schema.split(marker)[1].split('\n-- DEPLOYMENT 09: flow revamp\n')[0],repoCtx);
 assert.match(repoCtx,/add column if not exists repo_context jsonb/);
 assert.match(repoCtx,/stack_source in \('detected','user'\)/);
 assert.equal((repoCtx.split('$stack_source$').length-1)%2,0);
});

const flow=fs.readFileSync(path.join(sqlDir,'011_flow_revamp.sql'),'utf8');
test('fresh schema embeds the exact current migration 011 (flow revamp)',()=>{
 const marker='\n-- DEPLOYMENT 09: flow revamp\n';
 assert.ok(schema.includes(marker));
 assert.equal(schema.split(marker)[1].split('\n-- DEPLOYMENT 10: fidelity check\n')[0],flow);
});
const fid=fs.readFileSync(path.join(sqlDir,'012_fidelity.sql'),'utf8');
test('fresh schema embeds the exact current migration 012 (fidelity check)',()=>{
 const marker='\n-- DEPLOYMENT 10: fidelity check\n';
 assert.ok(schema.includes(marker));
 assert.equal(schema.split(marker)[1],fid);
});
test('migration 012 is additive and stores the reference beside the context',()=>{
 assert.doesNotMatch(fid,/drop\s+(table|column)/i);
 assert.match(fid,/add column if not exists reference_png text/);
 assert.match(fid,/add column if not exists reference_scale real/);
 assert.match(fid,/^begin;/m);
 assert.match(fid,/^commit;\s*$/m);
});
test('migration 011 is additive and pairs its delimiters',()=>{
 assert.doesNotMatch(flow,/drop\s+table/i);
 assert.doesNotMatch(flow,/drop\s+column/i);
 for(const tag of ['$$','$sync_link$','$profile_model$','$snapshot$','$buffer$']){
  assert.equal((flow.split(tag).length-1)%2,0,'Odd number of '+tag+' delimiters');
 }
 assert.match(flow,/^begin;/m);
 assert.match(flow,/^commit;\s*$/m);
});
test('migration 011 charges a 10 second server-start buffer, capped at the reservation',()=>{
 assert.match(flow,/build_start_buffer_seconds\(\)\s*returns integer language sql immutable as \$buffer\$ select 10 \$buffer\$/);
 assert.match(flow,/r\.started_at is not null and r\.state<>'finished'/);
 assert.match(flow,/least\(public\.build_start_buffer_seconds\(\),r\.reserved_seconds-r\.billed_seconds\)/);
 assert.ok(flow.includes('grant execute on function public.finish_metered_job(uuid,text,jsonb,text) to service_role'));
});
test('migration 011 adds project repository links with RLS',()=>{
 assert.match(flow,/create table if not exists public\.project_repos/);
 assert.match(flow,/unique \(project_id, repository, branch, app_root\)/);
 assert.match(flow,/on public\.project_repos\(project_id\) where is_default/);
 assert.match(flow,/alter table public\.project_repos enable row level security/);
 assert.match(flow,/create trigger sync_project_repo_link/);
 assert.match(flow,/add column if not exists ai_agent text/);
});
