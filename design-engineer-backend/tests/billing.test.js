'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const billing=require('../services/billing');

test('constant-time signature comparison rejects malformed and mismatched hashes',()=>{
 const expected=crypto.createHash('sha256').update('hello').digest('hex');
 assert.equal(billing.constantHexEqual(expected,expected),true);
 assert.equal(billing.constantHexEqual(expected,'0'.repeat(64)),false);
 assert.equal(billing.constantHexEqual(expected,'invalid'),false);
});

test('job submission is delegated to a single atomic quota-and-insert RPC',async()=>{
 const oldFetch=global.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const requests=[];
 process.env.SUPABASE_URL='https://project.supabase.co';
 process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
 global.fetch=async(url,options)=>{requests.push({url:String(url),options});
  return new Response(JSON.stringify('9066285f-289b-4c89-a6d3-8ec529e0fc06'),
   {status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const result=await billing.createJob('user-id','project-id',[{screen:'Home'}],'encrypted-token');
  assert.equal(result,'9066285f-289b-4c89-a6d3-8ec529e0fc06');
  assert.equal(requests.length,1);
  assert.match(requests[0].url,/\/rest\/v1\/rpc\/create_metered_job$/);
  const body=JSON.parse(requests[0].options.body);
  assert.equal(body.p_user,'user-id');
  assert.equal(body.p_project,'project-id');
  assert.deepEqual(body.p_screens,[{screen:'Home'}]);
  assert.equal(body.p_encrypted_token,'encrypted-token');
 }finally{
  global.fetch=oldFetch;
  if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
 }
});

test('metering and finalization use verified database functions',async()=>{
 const oldFetch=global.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const paths=[];
 process.env.SUPABASE_URL='https://project.supabase.co';
 process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
 global.fetch=async(url,options)=>{
  paths.push({path:new URL(url).pathname,body:JSON.parse(options.body)});
  return Response.json(true);
 };
 try{
  await billing.meterJob('job-id');
  await billing.finishJob('job-id','failed',null,'Timeout');
  assert.deepEqual(paths.map(p=>p.path),[
   '/rest/v1/rpc/meter_job_seconds',
   '/rest/v1/rpc/finish_metered_job'
  ]);
  assert.deepEqual(paths[1].body,{p_job:'job-id',p_status:'failed',p_result:null,p_error:'Timeout'});
 }finally{
  global.fetch=oldFetch;
  if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
 }
});
