'use strict';
// Database-backed usage ledger + Razorpay Orders (30-day prepaid membership).
// No billing secrets or service-role credentials are sent to the Figma UI.
const crypto=require('node:crypto');
const express=require('express');
const checkoutPage=require('./checkout-page');
const {createRecurring}=require('./recurring');
const BASE=()=>process.env.SUPABASE_URL;
const KEY=()=>process.env.SUPABASE_SERVICE_ROLE_KEY;
function envReady(){return !!(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET&&process.env.RAZORPAY_WEBHOOK_SECRET)}
function encode(value){return encodeURIComponent(String(value))}
function constantHexEqual(a,b){
 if(typeof a!=='string'||! /^[a-f0-9]{64}$/i.test(a)||typeof b!=='string'||! /^[a-f0-9]{64}$/i.test(b))return false;
 return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
function sha(value){return crypto.createHash('sha256').update(value).digest('hex')}
const PLAN_RANK={free:0,plus:1,studio:2};
function canUpgrade(current,target){return Object.hasOwn(PLAN_RANK,target)&&Object.hasOwn(PLAN_RANK,current)&&PLAN_RANK[target]>PLAN_RANK[current]}
function paidMembershipExpired(sub,at=Date.now()){return !!sub&&['plus','studio'].includes(sub.plan_slug)&&!!sub.expires_at&&Date.parse(sub.expires_at)<=at}
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
async function membership(userId){const rows=await service('user_subscriptions?user_id=eq.'+encode(userId)+'&select=plan_slug,status,expires_at,metadata&limit=1');return rows?.[0]||null;}
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
// Razorpay sends cumulative payment.amount_refunded; refund.amount is this refund only.
function refundedAmount(pay,refund){
 const values=[pay?.amount_refunded,refund?.amount].map(Number).filter(Number.isFinite);
 return values.length?Math.max(...values):0;
}
async function revokeRefund(orderId,paymentId,amount){
 return rpc('revoke_refunded_payment',{p_order:orderId,p_payment:paymentId,
  p_refunded_amount:Math.trunc(amount)});
}
async function history(userId,limit=20){return rpc('billing_history',{p_user:userId,p_limit:limit})}
async function webhookSeen(eventId){
 const rows=await service('billing_webhook_events?event_id=eq.'+encode(eventId)+'&select=event_id&limit=1');
 return !!rows?.length;
}
async function recordWebhook(eventId,type){
 return service('billing_webhook_events',{method:'POST',
  prefer:'resolution=ignore-duplicates,return=minimal',
  body:{event_id:eventId,event_type:type.slice(0,64)}});
}
const recurring=createRecurring({service,rpc,razorpay,encode,sha,constantHexEqual,balance,envReady,respondError:(res,e)=>respondError(res,e)});
function respondError(res,error){
 console.warn('[Design Engineer] Billing request error',error?.dbCode||error?.status||'unknown');
 return res.status(error?.status>=400&&error.status<500?error.status:503)
   .json({error:[400,403,409,429].includes(error?.status)?error.message:'Billing service unavailable. Please try again.'});
}

function registerWebhook(app){
 // Express raw body must be parsed BEFORE express.json() middleware.
 app.post('/billing/webhook',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
  const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
  if(!secret||!Buffer.isBuffer(req.body))return res.status(503).end();
  const provided=req.get('x-razorpay-signature')||'';
  const signature=crypto.createHmac('sha256',secret).update(req.body).digest('hex');
  if(!constantHexEqual(signature,provided))return res.status(401).end();
  const eventId=String(req.get('x-razorpay-event-id')||'').slice(0,128);
  try{
   // Razorpay retries deliveries; skip events already processed successfully.
   if(eventId&&await webhookSeen(eventId))return res.status(200).json({ok:true,duplicate:true});
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
   // A subscription invoice is granted only from a verified captured charge,
   // not from mandate authorization, subscription.activated or payment.captured.
   await recurring.handleWebhook(event);
   // Full refunds revoke the paid period they bought (decided atomically in SQL).
   if(event.event==='payment.refunded'){
    const pay=event.payload?.payment?.entity;
    const refund=event.payload?.refund?.entity;
    if(pay?.id){
     let order=pay.order_id;
     if(pay.subscription_id){
       const matches=await service('payments?razorpay_payment_id=eq.'+encode(pay.id)+
        '&select=razorpay_order_id&limit=1');
       order=matches?.[0]?.razorpay_order_id;
     }
     if(order)await revokeRefund(order,pay.id,refundedAmount(pay,refund));
    }
   }
   if(eventId)await recordWebhook(eventId,String(event.event||'unknown'));
   return res.status(200).json({ok:true});
  }catch(error){
   console.error('[Design Engineer] Razorpay webhook processing failed',error?.status||'unknown');
   return res.status(503).json({error:'Webhook processing unavailable'});
  }
 });
}
function registerRoutes(app,requireUser){
 recurring.registerRoutes(app,requireUser);
 app.get('/api/billing/status',async(req,res)=>{
  const auth=await requireUser(req,res);if(!auth)return;
  try{
   await rpc('expire_paid_membership',{p_user:auth.user.id});
   const [usage,plans,sub,renewal]=await Promise.all([
    balance(auth.user.id),
    service('plans?is_active=eq.true&slug=in.(free,plus,studio)'+
      '&select=slug,name,build_minutes,price_inr,currency,features,sort_order&order=sort_order.asc'),
    membership(auth.user.id),
    recurring.status(auth.user.id)
   ]);
   res.set('Cache-Control','no-store').json({usage,plans,paymentsEnabled:envReady(),...renewal,membership:{expired:paidMembershipExpired(sub),previousPlan:paidMembershipExpired(sub)?sub.plan_slug:null,periodEnd:sub?.expires_at||null,prepaidCancellationScheduled:!!sub?.metadata?.prepaid_cancelled_at&&!!sub?.metadata?.prepaid_cancelled_period_end&&Date.parse(sub.metadata.prepaid_cancelled_period_end)===Date.parse(sub.expires_at)}});
  }catch(error){return respondError(res,error)}
 });
 app.post('/api/billing/prepaid/cancel',async(req,res)=>{
  const auth=await requireUser(req,res);if(!auth)return;
  try {
   const data=await rpc('cancel_prepaid_membership',{p_user:auth.user.id});
   return res.set('Cache-Control','no-store').json(data);
  } catch(error){
   if(error?.message?.includes('NO_ACTIVE_PREPAID_PLAN'))
    return res.status(409).json({error:'There is no active prepaid plan to cancel.'});
   if(error?.message?.includes('RECURRING_MANDATE_MUST_BE_CANCELLED_SEPARATELY'))
    return res.status(409).json({error:'Cancel the Razorpay automatic renewal instead.'});
   return respondError(res,error);
  }
 });
 app.get('/api/billing/history',async(req,res)=>{
  const auth=await requireUser(req,res);if(!auth)return;
  try{
   const data=await history(auth.user.id,20);
   res.set('Cache-Control','no-store').json({
    builds:Array.isArray(data?.builds)?data.builds:[],
    payments:Array.isArray(data?.payments)?data.payments:[]
   });
  }catch(error){return respondError(res,error)}
 });
 app.post('/api/billing/order',async(req,res)=>{
  const auth=await requireUser(req,res);if(!auth)return;
  const slug=req.body?.plan;
  if(!['plus','studio'].includes(slug))return res.status(400).json({error:'Choose Plus or Studio.'});
  try{
   const usage=await balance(auth.user.id);
   if(!canUpgrade(usage.plan,slug))return res.status(409).json({error:usage.plan==='studio'?'You are already on the highest Studio plan.':'You already have this plan or a higher plan. Only upgrades are available.'});
   if(!envReady())return res.status(503).json({error:'Razorpay keys not configured.'});
   // Avoid unbounded provider-side order creation from repeated plugin clicks.
   const since=new Date(Date.now()-60*60*1000).toISOString();
   const recent=await service('payments?user_id=eq.'+encode(auth.user.id)+
     '&created_at=gte.'+encode(since)+'&select=id&limit=6');
   if((recent||[]).length>=5)
     return res.status(429).json({error:'Too many checkout attempts. Retry in an hour.'});
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
  res.set({'Content-Security-Policy':checkoutPage.CHECKOUT_CSP,'Cache-Control':'no-store',
   'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
  if(!/^order_[a-zA-Z0-9]+$/.test(order)||! /^[a-f0-9]{64}$/.test(token))
   return res.status(400).type('html').send(checkoutPage.renderNotice('This checkout link isn\u2019t valid',
    'Open Design Engineer in Figma, go to Plans & minutes and choose your plan again.'));
  try{
   const rows=await service('payments?razorpay_order_id=eq.'+encode(order)+
    '&select=user_id,plan_slug,amount,currency,status,checkout_token_hash,checkout_expires_at&limit=1');
   const p=rows?.[0];
   if(!p||!constantHexEqual(sha(token),p.checkout_token_hash||'')||
      Date.parse(p.checkout_expires_at)<Date.now()||p.status!=='created')
    return res.status(403).type('html').send(checkoutPage.renderNotice('This checkout link has expired',
     'Links last 15 minutes and work once. Open Design Engineer in Figma and choose your plan again. If you already paid, your minutes are on their way: check Plans & minutes before paying again.'));
   const active=await balance(p.user_id);
   if(!canUpgrade(active.plan,p.plan_slug))return res.status(409).type('html').send(checkoutPage.renderNotice('You already have this plan','Your account is already on this plan or higher. No additional payment is needed.'));
   const plans=await service('plans?slug=eq.'+encode(p.plan_slug)+'&select=name,build_minutes&limit=1').catch(()=>null);
   const plan=plans?.[0];
   return res.type('html').send(checkoutPage.renderCheckout({
    planName:plan?.name||(p.plan_slug==='studio'?'Studio':'Plus'),
    buildMinutes:plan?.build_minutes,amount:p.amount,currency:p.currency,
    keyId:process.env.RAZORPAY_KEY_ID,orderId:order,token}));
  }catch(error){return res.status(503).type('html').send(checkoutPage.renderNotice('Checkout is unavailable right now',
   'Nothing was charged. Please try again in a minute from Plans & minutes in the plugin.'))}
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
 finishJob,constantHexEqual,verifyCapturedPayment,grantPayment,revokeRefund,
 refundedAmount,history,canUpgrade,paidMembershipExpired};
