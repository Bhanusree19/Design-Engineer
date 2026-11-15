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
    assert.match(source,/['"]Studio['"],['"]studio['"],200,4999/);
    assert.match(source,/['"]Plus['"],['"]plus['"],100,2999/);
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
 assert.equal(schema.split(marker)[1],migration);
});
