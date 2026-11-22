'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const express=require('express');
const {createRecurring}=require('../services/recurring');
const billing=require('../services/billing');
test('only upward upgrades are eligible',()=>{
 for(const [old,target,expected] of [['free','plus',true],['free','studio',true],['plus','studio',true],['plus','plus',false],['studio','studio',false],['studio','plus',false]])
  assert.equal(billing.canUpgrade(old,target),expected);
});
function setup({usage='free',recurringRows=[],payment={id:'pay_first',status:'captured',subscription_id:'sub_existing',amount:169900,currency:'INR'}}={}){
 const prev={};for(const [k,v] of Object.entries({RAZORPAY_PLUS_PLAN_ID:'plan_plus',RAZORPAY_STUDIO_PLAN_ID:'plan_studio',RAZORPAY_KEY_ID:'rzp_test',RAZORPAY_KEY_SECRET:'testsecret'})){prev[k]=process.env[k];process.env[k]=v}
 const calls=[],rows=recurringRows.map(r=>({...r}));
 const service=async(path,o={})=>{
  calls.push({type:'db',path,o});
  if(path.startsWith('recurring_subscriptions?')&&o.method!=='PATCH')return rows;
  if(path.startsWith('plans?'))return [{id:'uuid',price_inr:path.includes('studio')?1699:799,currency:'INR'}];
  if(path==='recurring_subscriptions'){rows.unshift({...o.body,created_at:new Date().toISOString()});return null}
  if(path.startsWith('recurring_subscriptions?')&&o.method==='PATCH'){
   const row=rows.find(r=>path.includes(encodeURIComponent(r.razorpay_subscription_id)));
   if(row)Object.assign(row,o.body);
  }
  return null;
 };
 const razorpay=async(path,o={})=>{
  calls.push({type:'gateway',path,o});
  if(path.startsWith('plans/'))return {id:path.slice(6),period:'monthly',interval:1,item:{amount:path.includes('studio')?169900:79900,currency:'INR'}};
  if(path==='subscriptions')return {id:'sub_created',plan_id:o.body.plan_id};
  if(path.endsWith('/cancel'))return {id:path.split('/')[1],status:'active'};
  if(path.startsWith('payments/'))return payment;
  throw Error('unexpected '+path);
 };
 const recurring=createRecurring({service,razorpay,rpc:async(name,body)=>{calls.push({type:'rpc',name,body});return true},
  encode:encodeURIComponent,sha:s=>crypto.createHash('sha256').update(s).digest('hex'),constantHexEqual:(a,b)=>a===b,
  balance:async()=>({plan:usage}),envReady:()=>true,respondError:(res,e)=>res.status(e.status||503).json({error:e.message})});
 const app=express();app.use(express.json());recurring.registerRoutes(app,async()=>({user:{id:'user1'}}));
 const server=app.listen(0);
 return {calls,rows,recurring,url:()=> 'http://127.0.0.1:'+server.address().port,
  close:()=>{server.close();for(const [k,v] of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v}}};
}
test('Studio is blocked from checkout',async()=>{
 const h=setup({usage:'studio'});try{
  const r=await fetch(h.url()+'/api/billing/subscription/start',{method:'POST',headers:{'content-type':'application/json'},body:'{"plan":"studio"}'});
  assert.equal(r.status,409);
  assert.equal(h.calls.filter(c=>c.type==='gateway').length,0);
 }finally{h.close()}
});
test('Plus upgrade to Studio cancels old mandate at cycle end',async()=>{
 const h=setup({usage:'plus',recurringRows:[{razorpay_subscription_id:'sub_old',status:'active',plan_slug:'plus',cancel_at_period_end:false,created_at:'2020-01-01'}]});try{
  const r=await fetch(h.url()+'/api/billing/subscription/start',{method:'POST',headers:{'content-type':'application/json'},body:'{"plan":"studio"}'});
  assert.equal(r.status,201);
  assert.match((await r.json()).checkoutUrl,/sub_created/);
  assert.ok(h.calls.some(c=>c.path==='subscriptions/sub_old/cancel'&&c.o.body.cancel_at_cycle_end));
 }finally{h.close()}
});
test('authorizing a mandate never grants minutes; captured charge uses idempotent RPC',async()=>{
 const h=setup({recurringRows:[{razorpay_subscription_id:'sub_existing',status:'created',plan_slug:'studio',created_at:'2020-01-01'}]});try{
  await h.recurring.handleWebhook({event:'subscription.authenticated',payload:{subscription:{entity:{id:'sub_existing'}}}});
  assert.equal(h.calls.filter(c=>c.type==='rpc').length,0);
  await h.recurring.handleWebhook({event:'subscription.charged',payload:{subscription:{entity:{id:'sub_existing'}},payment:{entity:{id:'pay_first'}}}});
  const rpc=h.calls.find(c=>c.type==='rpc');
  assert.equal(rpc.name,'apply_recurring_charge');assert.equal(rpc.body.p_amount,169900);
 }finally{h.close()}
});
test('cancelling renewal keeps the active paid plan',async()=>{
 const h=setup({recurringRows:[{razorpay_subscription_id:'sub_existing',status:'active',plan_slug:'studio',cancel_at_period_end:false,created_at:'2020-01-01'}]});try{
  const r=await fetch(h.url()+'/api/billing/subscription/cancel',{method:'POST'});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{success:true,cancelAtPeriodEnd:true});
  assert.equal(h.rows[0].cancel_at_period_end,true);
 }finally{h.close()}
});
