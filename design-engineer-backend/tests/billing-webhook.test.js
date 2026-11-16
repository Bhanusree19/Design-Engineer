'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const billing=require('../services/billing');

const ENV={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service',
 RAZORPAY_KEY_ID:'rzp_test_x',RAZORPAY_KEY_SECRET:'key-secret',RAZORPAY_WEBHOOK_SECRET:'hook-secret'};

// Starts the real webhook route; Supabase calls are answered by `db`.
async function withWebhook(db,run){
 const saved={},realFetch=global.fetch;
 for(const [k,v] of Object.entries(ENV)){saved[k]=process.env[k];process.env[k]=v}
 const calls=[];
 global.fetch=async(url,options={})=>{
  const u=new URL(String(url));
  if(u.hostname!=='project.supabase.co')return realFetch(url,options);
  const call={method:options.method||'GET',path:u.pathname,search:u.search,
   body:options.body?JSON.parse(options.body):undefined};
  calls.push(call);
  return Response.json(db(call)??null);
 };
 const app=express();billing.registerWebhook(app);
 const server=app.listen(0);
 const base='http://127.0.0.1:'+server.address().port;
 const send=(payload,{eventId,signature}={})=>{
  const raw=JSON.stringify(payload);
  return realFetch(base+'/billing/webhook',{method:'POST',body:raw,headers:{
   'content-type':'application/json',
   'x-razorpay-signature':signature??crypto.createHmac('sha256',ENV.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex'),
   ...(eventId?{'x-razorpay-event-id':eventId}:{})}});
 };
 try{await run(send,calls)}finally{
  server.close();global.fetch=realFetch;
  for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v}
 }
}
const refundEvent={event:'payment.refunded',payload:{
 payment:{entity:{id:'pay_ABC',order_id:'order_XYZ',amount:79900,amount_refunded:79900}},
 refund:{entity:{amount:79900}}}};

test('webhook rejects a bad signature without touching the database',async()=>{
 await withWebhook(()=>null,async(send,calls)=>{
  const res=await send(refundEvent,{signature:'0'.repeat(64)});
  assert.equal(res.status,401);
  assert.equal(calls.length,0);
 });
});

test('full refund webhook revokes through the atomic SQL function and records the event',async()=>{
 await withWebhook(()=>[],async(send,calls)=>{
  const res=await send(refundEvent,{eventId:'evt_1'});
  assert.equal(res.status,200);
  const rpc=calls.find(c=>c.path==='/rest/v1/rpc/revoke_refunded_payment');
  assert.deepEqual(rpc.body,{p_order:'order_XYZ',p_payment:'pay_ABC',p_refunded_amount:79900});
  assert.ok(calls.some(c=>c.method==='POST'&&c.path==='/rest/v1/billing_webhook_events'
   &&c.body.event_id==='evt_1'));
  // No direct table PATCHes on payments/subscriptions any more.
  assert.ok(!calls.some(c=>c.method==='PATCH'));
 });
});

test('replayed webhook event is acknowledged and skipped',async()=>{
 await withWebhook(c=>c.path==='/rest/v1/billing_webhook_events'&&c.method==='GET'
  ?[{event_id:'evt_1'}]:null,async(send,calls)=>{
  const res=await send(refundEvent,{eventId:'evt_1'});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,duplicate:true});
  assert.equal(calls.length,1);
 });
});

test('refunded amount uses the cumulative payment total when present',()=>{
 assert.equal(billing.refundedAmount({amount_refunded:300},{amount:100}),300);
 assert.equal(billing.refundedAmount({},{amount:100}),100);
 assert.equal(billing.refundedAmount(undefined,undefined),0);
});

test('usage history is read through a single service-role RPC',async()=>{
 const oldFetch=global.fetch,saved={...process.env};
 Object.assign(process.env,ENV);
 const seen=[];
 global.fetch=async(url,options)=>{seen.push({path:new URL(url).pathname,body:JSON.parse(options.body)});
  return Response.json({builds:[],payments:[]})};
 try{
  assert.deepEqual(await billing.history('user-1',20),{builds:[],payments:[]});
  assert.deepEqual(seen,[{path:'/rest/v1/rpc/billing_history',body:{p_user:'user-1',p_limit:20}}]);
 }finally{
  global.fetch=oldFetch;
  for(const k of Object.keys(ENV)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k]}
 }
});
