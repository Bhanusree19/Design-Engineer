'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const billing=require('../services/billing');
const {renderCheckout}=require('../services/checkout-page');

const ENV={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'svc',
 RAZORPAY_KEY_ID:'rzp_test_abc',RAZORPAY_KEY_SECRET:'secret',RAZORPAY_WEBHOOK_SECRET:'hook',WEBSITE_URL:'https://designengineer.example'};
const TOKEN='a'.repeat(64);
const sha=(v)=>crypto.createHash('sha256').update(v).digest('hex');

async function withRoute(db,run){
 const saved={},realFetch=global.fetch;
 for(const [k,v] of Object.entries(ENV)){saved[k]=process.env[k];process.env[k]=v}
 global.fetch=async(url,options={})=>{
  const u=new URL(String(url));
  if(u.hostname!=='project.supabase.co')return realFetch(url,options);
  return Response.json(db(u.pathname,u.search));
 };
 const app=express();app.use(express.json());
 billing.registerRoutes(app,async()=>null);
 const server=app.listen(0);
 const base='http://127.0.0.1:'+server.address().port;
 try{await run((path)=>realFetch(base+path))}finally{
  server.close();global.fetch=realFetch;
  for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v}
 }
}
const payment={plan_slug:'plus',amount:79900,currency:'INR',status:'created',
 checkout_token_hash:sha(TOKEN),checkout_expires_at:new Date(Date.now()+600000).toISOString()};

test('checkout page shows the plan, minutes and price in the website design',async()=>{
 await withRoute((path)=>{
   if(path.endsWith('/rpc/minute_balance'))return {plan:'free'};
   return path.endsWith('/payments')?[{...payment,user_id:'user1'}]:[{name:'Plus',build_minutes:100}];
 },async(get)=>{
  const res=await get('/billing/checkout?order=order_ABC123&token='+TOKEN);
  assert.equal(res.status,200);
  const html=await res.text();
  assert.match(html,/100 build minutes, ready in seconds\./);
  assert.match(html,/Pay ₹799 securely with Razorpay/);
  assert.match(html,/Opened from your Figma plugin/);
  assert.match(html,/href="https:\/\/designengineer\.example\/terms"/);
  assert.match(html,/"order_id":"order_ABC123"/);
  const csp=res.headers.get('content-security-policy');
  assert.match(csp,/font-src https:\/\/fonts\.gstatic\.com/);
  assert.match(csp,/script-src 'unsafe-inline' https:\/\/checkout\.razorpay\.com/);
  assert.equal(res.headers.get('cache-control'),'no-store');
 });
});

test('invalid and expired links get a styled explanation, not plain text',async()=>{
 await withRoute(()=>[{...payment,checkout_expires_at:new Date(Date.now()-1000).toISOString()}],async(get)=>{
  const bad=await get('/billing/checkout?order=nope&token=x');
  assert.equal(bad.status,400);
  assert.match(await bad.text(),/This checkout link isn’t valid/);
  const old=await get('/billing/checkout?order=order_ABC123&token='+TOKEN);
  assert.equal(old.status,403);
  const text=await old.text();
  assert.match(text,/This checkout link has expired/);
  assert.match(text,/check Plans &amp; minutes before paying again/);
 });
});

test('plan names and options are escaped against HTML and script injection',()=>{
 const html=renderCheckout({planName:'</script><img src=x onerror=alert(1)>',buildMinutes:100,amount:79900,currency:'INR',
  keyId:'rzp_test_abc',orderId:'order_X',token:TOKEN});
 assert.doesNotMatch(html,/<img src=x/);
 assert.doesNotMatch(html,/<\/script><img/);
 assert.match(html,/\\u003c\/script\\u003e/);
});

test('stale checkout link cannot charge a user already on Studio',async()=>{
 await withRoute(path=>path.endsWith('/rpc/minute_balance')?{plan:'studio'}:
   path.endsWith('/payments')?[{...payment,user_id:'user1'}]:null,async(get)=>{
   const res=await get('/billing/checkout?order=order_ABC123&token='+TOKEN);
   assert.equal(res.status,409);
   assert.match(await res.text(),/You already have this plan/);
 });
});
