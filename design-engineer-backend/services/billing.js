'use strict';
// Database-backed usage ledger + Razorpay Orders (30-day prepaid membership).
// No billing secrets or service-role credentials are sent to the Figma UI.
const crypto=require('node:crypto');
const express=require('express');
const BASE=()=>process.env.SUPABASE_URL;
const KEY=()=>process.env.SUPABASE_SERVICE_ROLE_KEY;
function envReady(){return !!(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET&&process.env.RAZORPAY_WEBHOOK_SECRET)}
function encode(value){return encodeURIComponent(String(value))}
function constantHexEqual(a,b){
 if(typeof a!=='string'||! /^[a-f0-9]{64}$/i.test(a)||typeof b!=='string'||! /^[a-f0-9]{64}$/i.test(b))return false;
 return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
function sha(value){return crypto.createHash('sha256').update(value).digest('hex')}
function apiError(message,status=503){const e=new Error(message);e.status=status;return e}
async function service(path,{method='GET',body,prefer}={}){
 if(!BASE()||!KEY())throw apiError('Subscription storage is not configured.');
 const response=await fetch(BASE().replace(/\/+$/,'')+'/rest/v1/'+path,{
  method,headers:{apikey:KEY(),Authorization:'Bearer '+KEY(),
    'Content-Type':'application/json',Accept:'application/json',
    ...(prefer?{Prefer:prefer}:{})},
  body:body===undefined?undefined:JSON.stringify(body)
 });
 const raw=await response.text(),json=raw?(()=>{try{return JSON.parse(raw)}catch{return null}})():null;
 if(!response.ok){
  const error=apiError(json?.message||'Billing database unavailable',response.status);
  error.dbCode=json?.code;
  throw error;
 }
 return json;
}
async function rpc(name,body){return service('rpc/'+name,{method:'POST',body})}
async function razorpay(path,{method='GET',body}={}){
 if(!envReady())throw apiError('Razorpay keys are not configured.');
 const credentials=Buffer.from(process.env.RAZORPAY_KEY_ID+':'+process.env.RAZORPAY_KEY_SECRET).toString('base64');
 const response=await fetch('https://api.razorpay.com/v1/'+path,{
  method,headers:{Authorization:'Basic '+credentials,'Content-Type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body),
  signal:AbortSignal.timeout(12000)
 });
 const json=await response.json().catch(()=>({}));
 if(!response.ok)throw apiError('Payment provider declined the request.',502);
 return json;
}
async function balance(userId){return rpc('minute_balance',{p_user:userId})}
async function finishJob(jobId,status,result=null,error=null){
 return rpc('finish_metered_job',{p_job:jobId,p_status:status,p_result:result,p_error:error});
}
async function meterJob(jobId){return rpc('meter_job_seconds',{p_job:jobId})}
async function claimJob(jobId){return rpc('claim_metered_job',{p_job:jobId})}
async function createJob(userId,projectId,screens,encryptedToken){
 return rpc('create_metered_job',{p_user:userId,p_project:projectId,
  p_screens:screens,p_encrypted_token:encryptedToken});
}
async function grantPayment(orderId,paymentId,signature){
 return rpc('grant_verified_payment',{
  p_order:orderId,p_payment:paymentId,p_signature:signature
 });
}
async function verifyCapturedPayment(orderId,paymentId,expected){
 if(!/^pay_[A-Za-z0-9]+$/.test(paymentId))throw apiError('Invalid payment reference.',400);
 const payment=await razorpay('payments/'+encode(paymentId));
 if(payment.status!=='captured'||payment.order_id!==orderId||
  payment.amount!==expected.amount||payment.currency!==expected.currency)
  throw apiError('Payment not yet captured or does not match the order.',409);
 return payment;
}
async function confirmedOrder(orderId,paymentId,signature){
 const rows=await service('payments?razorpay_order_id=eq.'+encode(orderId)+
  '&select=id,user_id,amount,currency,status,razorpay_payment_id&limit=1');
 const payment=rows?.[0];
 if(!payment)throw apiError('Order not found.',404);
 if(payment.status==='paid')return payment.razorpay_payment_id===paymentId;
 await verifyCapturedPayment(orderId,paymentId,payment);
 return grantPayment(orderId,paymentId,signature);
}
function respondError(res,error){
 console.warn('[Design Engineer] Billing request error',error?.dbCode||error?.status||'unknown');
 return res.status(error?.status>=400&&error.status<500?error.status:503)
   .json({error:error?.status===409?error.message:'Billing service unavailable. Please try again.'});
}
function escaped(value){return String(value).replace(/[&<>"']/g,s=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
 })[s]);}
function safeScript(value){return JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e')}

function registerWebhook(app){
 // Express raw body must be parsed BEFORE express.json() middleware.
 app.post('/billing/webhook',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
  const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
  if(!secret||!Buffer.isBuffer(req.body))return res.status(503).end();
  const provided=req.get('x-razorpay-signature')||'';
  const signature=crypto.createHmac('sha256',secret).update(req.body).digest('hex');
  if(!constantHexEqual(signature,provided))return res.status(401).end();
  try{
   const event=JSON.parse(req.body.toString('utf8'));
   if(event.event==='payment.captured'){
    const pay=event.payload?.payment?.entity;
    if(pay?.order_id&&pay?.id){
     const rows=await service('payments?razorpay_order_id=eq.'+encode(pay.order_id)+
      '&select=amount,currency,status&limit=1');
     const pending=rows?.[0];
     if(pending?.status==='created'){
      await verifyCapturedPayment(pay.order_id,pay.id,pending);
      await grantPayment(pay.order_id,pay.id,'webhook-verified');
     }
    }
   }
   // Handle refunds, including revocation of the currently paid entitlement.
   if(event.event==='payment.refunded'){
    const pay=event.payload?.payment?.entity;
    const refund=event.payload?.refund?.entity;
    if(pay?.order_id&&pay?.id&&refund?.amount>=pay.amount){
      const rows=await service('payments?razorpay_order_id=eq.'+encode(pay.order_id)+
       '&razorpay_payment_id=eq.'+encode(pay.id)+'&select=id,user_id,status&limit=1');
      const p=rows?.[0];
      if(p?.status==='paid'){
       await service('payments?id=eq.'+encode(p.id),{method:'PATCH',body:{status:'refunded'},
         prefer:'return=minimal'});
       const subs=await service('user_subscriptions?user_id=eq.'+encode(p.user_id)+
         '&select=started_at&limit=1');
       // Only deactivate when this is the latest paid period.
       const latest=await service('payments?user_id=eq.'+encode(p.user_id)+
         '&status=eq.paid&order=paid_at.desc&select=id&limit=1');
       if(!latest?.length){
        await service('user_subscriptions?user_id=eq.'+encode(p.user_id),{
         method:'PATCH',body:{status:'expired',expires_at:new Date().toISOString()},
         prefer:'return=minimal'});
       }
      }
    }
   }
   return res.status(200).json({ok:true});
  }catch(error){
   console.error('[Design Engineer] Razorpay webhook processing failed',error?.status||'unknown');
   return res.status(503).json({error:'Webhook processing unavailable'});
  }
 });
}
function registerRoutes(app,requireUser){
 app.get('/api/billing/status',async(req,res)=>{
  const auth=await requireUser(req,res);if(!auth)return;
  try{
   const [usage,plans]=await Promise.all([
    balance(auth.user.id),
    service('plans?is_active=eq.true&slug=in.(free,plus,studio)'+
      '&select=slug,name,build_minutes,price_inr,currency,features,sort_order&order=sort_order.asc')
   ]);
   res.set('Cache-Control','no-store').json({usage,plans,paymentsEnabled:envReady()});
  }catch(error){return respondError(res,error)}
 });
 app.post('/api/billing/order',async(req,res)=>{
  const auth=await requireUser(req,res);if(!auth)return;
  const slug=req.body?.plan;
  if(!['plus','studio'].includes(slug))return res.status(400).json({error:'Choose Plus or Studio.'});
  try{
   if(!envReady())return res.status(503).json({error:'Razorpay keys not configured.'});
   const plans=await service('plans?slug=eq.'+encode(slug)+
    '&is_active=eq.true&select=id,slug,name,price_inr,currency&limit=1');
   const plan=plans?.[0];
   if(!plan||!Number.isInteger(plan.price_inr)||plan.price_inr<1||
      plan.currency!=='INR')return res.status(400).json({error:'This plan is not available for checkout.'});
   const localId=crypto.randomUUID();
   const amount=plan.price_inr*100;
   const order=await razorpay('orders',{method:'POST',body:{
    amount,currency:'INR',receipt:'de_'+localId.slice(0,30),
    notes:{membership:slug}
   }});
   if(!order.id||order.amount!==amount||order.currency!=='INR')
    throw apiError('Razorpay returned invalid order.',502);
   const token=crypto.randomBytes(32).toString('hex');
   await service('payments',{method:'POST',prefer:'return=minimal',body:{
    id:localId,user_id:auth.user.id,plan_id:plan.id,plan_slug:slug,
    amount,currency:'INR',status:'created',razorpay_order_id:order.id,
    checkout_token_hash:sha(token),
    checkout_expires_at:new Date(Date.now()+15*60*1000).toISOString()
   }});
   const base=(process.env.BACKEND_URL||'').replace(/\/+$/,'');
   res.status(201).json({checkoutUrl:base+'/billing/checkout?order='+
    encode(order.id)+'&token='+encode(token)});
  }catch(error){return respondError(res,error)}
 });
 app.get('/billing/checkout',async(req,res)=>{
  const order=String(req.query.order||''),token=String(req.query.token||'');
  if(!/^order_[a-zA-Z0-9]+$/.test(order)||! /^[a-f0-9]{64}$/.test(token))
   return res.status(400).send('Invalid checkout link.');
  try{
   const rows=await service('payments?razorpay_order_id=eq.'+encode(order)+
    '&select=plan_slug,amount,currency,status,checkout_token_hash,checkout_expires_at&limit=1');
   const p=rows?.[0];
   if(!p||!constantHexEqual(sha(token),p.checkout_token_hash||'')||
      Date.parse(p.checkout_expires_at)<Date.now()||p.status!=='created')
    return res.status(403).send('Checkout link expired. Open Design Engineer and try again.');
   res.set({'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' https://checkout.razorpay.com; connect-src 'self' https://api.razorpay.com https://*.razorpay.com; img-src https: data:; style-src 'unsafe-inline'; frame-src https://*.razorpay.com https://api.razorpay.com; form-action 'self'",'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
   const options={key:process.env.RAZORPAY_KEY_ID,amount:p.amount,currency:p.currency,
     name:'Design Engineer',description:p.plan_slug+' — 30-day minutes plan',
     order_id:order};
   const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Design Engineer Checkout</title></head><body style="font-family:system-ui;max-width:480px;margin:50px auto;padding:20px">'+
    '<h2>Design Engineer — '+escaped(p.plan_slug)+'</h2><p>₹'+(p.amount/100).toFixed(2)+
    ' for 30 days. Manual renewal; no automatic debit.</p>'+
    '<button id="pay" style="padding:13px 28px">Pay securely with Razorpay</button>'+
    '<p id="msg" role="status"></p><script src="https://checkout.razorpay.com/v1/checkout.js"></script>'+
    '<script>const cfg='+safeScript(options)+';const token='+safeScript(token)+
    ';document.getElementById("pay").onclick=function(){if(!window.Razorpay){document.getElementById("msg").textContent="Checkout unavailable. Refresh.";return;}'+
    'const rz=new Razorpay({...cfg,handler:async function(result){'+
    'document.getElementById("msg").textContent="Verifying payment...";'+
    'try{const r=await fetch("/billing/confirm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...result,token})});'+
    'const data=await r.json();document.getElementById("msg").textContent=r.ok?"Payment verified. Return to Figma; minutes are available.":(data.error||"Verification pending; contact support.");}'+
    'catch{document.getElementById("msg").textContent="Verification pending; do not pay again. Contact support.";}}});'+
    'rz.open();};</script></body></html>';
   return res.type('html').send(html);
  }catch(error){return res.status(503).send('Checkout temporarily unavailable.')}
 });
 app.post('/billing/confirm',async(req,res)=>{
  const order=req.body?.razorpay_order_id,payment=req.body?.razorpay_payment_id,
   signature=req.body?.razorpay_signature,token=req.body?.token;
  if(!/^order_[A-Za-z0-9]+$/.test(order||'')||
     !/^pay_[A-Za-z0-9]+$/.test(payment||'')||
     !/^[a-f0-9]{64}$/i.test(signature||'')||
     !/^[a-f0-9]{64}$/.test(token||''))
   return res.status(400).json({error:'Malformed payment confirmation.'});
  try{
   const rows=await service('payments?razorpay_order_id=eq.'+encode(order)+
    '&select=status,checkout_token_hash,checkout_expires_at&limit=1');
   const pending=rows?.[0];
   if(!pending)return res.status(404).json({error:'Payment order not found.'});
   // Razorpay may deliver the captured-payment webhook before the browser's
   // success callback. In that case the consumed checkout token is already
   // erased, but a valid signature and matching captured payment still prove
   // the customer succeeded.
   const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET)
    .update(order+'|'+payment).digest('hex');
   if(!constantHexEqual(expected,signature))
    return res.status(401).json({error:'Payment signature could not be verified.'});
   if(pending.status==='paid'){
     const match=await confirmedOrder(order,payment,signature);
     return res.json({success:!!match});
   }
   if(!constantHexEqual(sha(token),pending.checkout_token_hash||'')||
      Date.parse(pending.checkout_expires_at)<Date.now())
    return res.status(403).json({error:'Checkout session expired. Check your billing status.'});
   const success=await confirmedOrder(order,payment,signature);
   return res.json({success:!!success});
  }catch(error){return respondError(res,error)}
 });
}
module.exports={registerWebhook,registerRoutes,balance,createJob,claimJob,meterJob,
 finishJob,constantHexEqual,verifyCapturedPayment,grantPayment};
