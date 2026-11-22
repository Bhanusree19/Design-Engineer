'use strict';
// Razorpay Subscriptions / mandates are separate from the existing one-time
// Orders checkout. No entitlement is granted for mandate authorization alone.
const crypto=require('node:crypto');
const checkout=require('./checkout-page');
const RANK={free:0,plus:1,studio:2};
const ID=/^sub_[A-Za-z0-9]+$/;
const PAY=/^pay_[A-Za-z0-9]+$/;
const PLAN=/^plan_[A-Za-z0-9]+$/;
function configured(){return !!(process.env.RAZORPAY_PLUS_PLAN_ID&&process.env.RAZORPAY_STUDIO_PLAN_ID)}
function planId(slug){return process.env[slug==='plus'?'RAZORPAY_PLUS_PLAN_ID':'RAZORPAY_STUDIO_PLAN_ID']}
function error(message,status=409){const e=new Error(message);e.status=status;return e}
function createRecurring({service,rpc,razorpay,encode,sha,constantHexEqual,balance,envReady,respondError}){
 const list=async userId=>{
   const rows=await service('recurring_subscriptions?user_id=eq.'+encode(userId)+
     '&select=razorpay_subscription_id,plan_slug,status,cancel_at_period_end,checkout_expires_at,created_at'+
     '&order=created_at.desc&limit=15');
   return Array.isArray(rows)?rows:[];
 };
 const current=async userId=>{
   const rows=await list(userId);
   return rows.find(r=>['created','authenticated','active','pending','halted'].includes(r.status))||rows[0]||null;
 };
 const publicRenewal=r=>r?{plan:r.plan_slug,status:r.status,
   autoRenew:!r.cancel_at_period_end&&r.status==='active',
   cancelAtPeriodEnd:r.cancel_at_period_end}:null;
 const status=async userId=>({recurringEnabled:envReady()&&configured(),
   renewal:publicRenewal(await current(userId))});
 async function validateProviderPlan(slug,plan){
   const id=planId(slug);
   if(!PLAN.test(id||''))throw error('Create monthly Plus and Studio subscription plans in Razorpay first.',503);
   const remote=await razorpay('plans/'+encode(id));
   if(remote.id!==id||remote.period!=='monthly'||remote.interval!==1||
      remote.item?.amount!==plan.price_inr*100||remote.item?.currency!=='INR')
     throw error('Razorpay monthly plan price/frequency differs from your database. Fix plan setup before accepting payments.',503);
 }
 async function cancelProvider(id,cycleEnd){
   if(!ID.test(id))throw error('Invalid subscription reference.',400);
   const result=await razorpay('subscriptions/'+encode(id)+'/cancel',{method:'POST',body:{cancel_at_cycle_end:!!cycleEnd}});
   if(result.id!==id||!['cancelled','active','pending','halted','authenticated','created'].includes(result.status))
     throw error('Razorpay did not confirm cancellation. Please retry.',503);
   return result;
 }
 function registerRoutes(app,requireUser){
  app.post('/api/billing/subscription/start',async(req,res)=>{
   const auth=await requireUser(req,res);if(!auth)return;
   const slug=req.body?.plan;
   if(!['plus','studio'].includes(slug))return res.status(400).json({error:'Choose Plus or Studio.'});
   try{
    if(!envReady()||!configured())throw error('Automatic renewal is not configured. Please contact support.',503);
    const usage=await balance(auth.user.id);
    if(!(RANK[slug]>RANK[usage.plan]))
      throw error(usage.plan==='studio'?'You are already on Studio, the highest plan.':'Only a higher plan can be purchased.');
    const rows=await list(auth.user.id);
    if(rows.some(r=>r.status==='created'&&Date.parse(r.checkout_expires_at||'')>Date.now()))
      throw error('Subscription authorization is already pending. Complete it or retry after the link expires.');
    for(const old of rows.filter(r=>r.status==='created')){
      const remote=await razorpay('subscriptions/'+encode(old.razorpay_subscription_id));
      if(!['created','cancelled','completed','expired'].includes(remote.status))
        throw error('A previous mandate was authorized. Refresh your billing status before trying again.');
      if(remote.status==='created')await cancelProvider(old.razorpay_subscription_id,false);
      await service('recurring_subscriptions?razorpay_subscription_id=eq.'+encode(old.razorpay_subscription_id)+'&user_id=eq.'+encode(auth.user.id),{
        method:'PATCH',body:{status:'cancelled',cancel_at_period_end:true,updated_at:new Date().toISOString()}
      });
    }
    if(rows.some(r=>r.plan_slug===slug&&['authenticated','active','pending','halted'].includes(r.status)))
      throw error('This plan already has an existing payment mandate. Check the subscription status before starting another.');
    if(rows.some(r=>!r.cancel_at_period_end&&['authenticated','active','pending','halted'].includes(r.status)&&
      (usage.plan==='free'||RANK[r.plan_slug]>=RANK[slug])))
      throw error('You already have an automatic-payment mandate. Cancel or resolve it before starting another plan.');
    const plans=await service('plans?slug=eq.'+encode(slug)+'&is_active=eq.true&select=id,slug,price_inr,currency&limit=1');
    const plan=plans?.[0];
    if(!plan||plan.currency!=='INR'||!Number.isInteger(plan.price_inr)||plan.price_inr<1)
      throw error('This plan is unavailable.',400);
    await validateProviderPlan(slug,plan);
    const gateway=await razorpay('subscriptions',{method:'POST',body:{
      plan_id:planId(slug),total_count:120,quantity:1,customer_notify:1,
      notes:{product:'Design Engineer',tier:slug}
    }});
    if(!ID.test(gateway.id||'')||gateway.plan_id!==planId(slug))
      throw error('Razorpay did not create a valid subscription.',503);
    // Prevent two mandates renewing simultaneously on Plus -> Studio.
    // The old paid entitlement remains until its normal expiry.
    try{
      for(const old of rows.filter(r=>r.status==='active'&&!r.cancel_at_period_end)){
        await cancelProvider(old.razorpay_subscription_id,true);
        await service('recurring_subscriptions?razorpay_subscription_id=eq.'+
          encode(old.razorpay_subscription_id)+'&user_id=eq.'+encode(auth.user.id),{
          method:'PATCH',body:{cancel_at_period_end:true,updated_at:new Date().toISOString()}
        });
      }
      const token=crypto.randomBytes(32).toString('hex');
      const expiresAt=new Date(Date.now()+15*60*1000).toISOString();
      await service('recurring_subscriptions',{method:'POST',body:{
        user_id:auth.user.id,razorpay_subscription_id:gateway.id,plan_slug:slug,
        amount_paise:plan.price_inr*100,currency:plan.currency,
        status:'created',checkout_token_hash:sha(token),checkout_expires_at:expiresAt
      }});
      const base=(process.env.BACKEND_URL||'').replace(/\/+$/,'');
      return res.status(201).json({checkoutUrl:base+'/billing/subscription/checkout?sub='+
        encode(gateway.id)+'&token='+token});
    }catch(e){
      await cancelProvider(gateway.id,false).catch(()=>{});
      throw e;
    }
   }catch(e){return respondError(res,e)}
  });
  app.post('/api/billing/subscription/cancel',async(req,res)=>{
   const auth=await requireUser(req,res);if(!auth)return;
   try{
    const row=await current(auth.user.id);
    if(!row||row.status==='cancelled'||row.status==='completed')
      return res.status(409).json({error:'You do not have an active automatic renewal to cancel.'});
    if(row.cancel_at_period_end)return res.json({success:true,cancelAtPeriodEnd:true});
    const atCycleEnd=row.status==='active'||row.status==='pending'||row.status==='halted';
    await cancelProvider(row.razorpay_subscription_id,atCycleEnd);
    await service('recurring_subscriptions?razorpay_subscription_id=eq.'+
       encode(row.razorpay_subscription_id)+'&user_id=eq.'+encode(auth.user.id),{
      method:'PATCH',body:{cancel_at_period_end:true,
       ...(atCycleEnd?{}:{status:'cancelled'}),updated_at:new Date().toISOString()}
    });
    return res.json({success:true,cancelAtPeriodEnd:atCycleEnd});
   }catch(e){return respondError(res,e)}
  });
  app.get('/billing/subscription/checkout',async(req,res)=>{
   const sub=String(req.query.sub||''),token=String(req.query.token||'');
   res.set({'Content-Security-Policy':checkout.CHECKOUT_CSP,
      'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
      'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
   if(!ID.test(sub)||!/^[a-f0-9]{64}$/.test(token))
     return res.status(400).type('html').send(checkout.renderNotice('Invalid subscription link','Return to Figma and choose your plan again.'));
   try{
    const rows=await service('recurring_subscriptions?razorpay_subscription_id=eq.'+encode(sub)+
     '&select=user_id,plan_slug,status,checkout_token_hash,checkout_expires_at&limit=1');
    const row=rows?.[0];
    if(!row||row.status!=='created'||!constantHexEqual(sha(token),row.checkout_token_hash||'')||
      Date.parse(row.checkout_expires_at)<=Date.now())
      return res.status(403).type('html').send(checkout.renderNotice('Subscription link expired','Return to Figma and open a new upgrade.'));
    const effective=await balance(row.user_id);
    if(!(RANK[row.plan_slug]>RANK[effective.plan]))
      return res.status(409).type('html').send(checkout.renderNotice('You already have this plan','Your account is already on this tier or higher. No additional payment is needed.'));
    const plans=await service('plans?slug=eq.'+encode(row.plan_slug)+'&select=name,price_inr,build_minutes&limit=1');
    return res.type('html').send(checkout.renderSubscriptionCheckout({
      subscriptionId:sub,token,keyId:process.env.RAZORPAY_KEY_ID,
      planName:plans?.[0]?.name||row.plan_slug,
      priceInr:plans?.[0]?.price_inr||0,
      buildMinutes:plans?.[0]?.build_minutes||0
    }));
   }catch(e){return res.status(503).type('html').send(checkout.renderNotice('Subscription unavailable','Please try again later from Figma.'))}
  });
  app.post('/billing/subscription/confirm',async(req,res)=>{
   const sub=req.body?.razorpay_subscription_id,pay=req.body?.razorpay_payment_id,
     sig=req.body?.razorpay_signature,token=req.body?.token;
   if(!ID.test(sub||'')||!PAY.test(pay||'')||!/^[a-f0-9]{64}$/i.test(sig||'')||
      !/^[a-f0-9]{64}$/.test(token||''))
      return res.status(400).json({error:'Invalid subscription confirmation.'});
   try{
    const rows=await service('recurring_subscriptions?razorpay_subscription_id=eq.'+encode(sub)+
     '&select=checkout_token_hash,checkout_expires_at&limit=1');
    const row=rows?.[0];
    if(!row||!constantHexEqual(sha(token),row.checkout_token_hash||'')||
      Date.parse(row.checkout_expires_at)<=Date.now())
      return res.status(403).json({error:'Authorization link expired. Check billing status.'});
    const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET)
      .update(pay+'|'+sub).digest('hex');
    if(!constantHexEqual(sig,expected))
      return res.status(401).json({error:'Invalid authorization signature.'});
    // A valid mandate approval is not necessarily a paid invoice.
    return res.json({success:true,pendingActivation:true});
   }catch(e){return respondError(res,e)}
  });
 }
 async function handleWebhook(event){
  const type=String(event.event||'');
  if(!type.startsWith('subscription.'))return false;
  const sub=event.payload?.subscription?.entity;
  if(!ID.test(sub?.id||''))return true;
  const rows=await service('recurring_subscriptions?razorpay_subscription_id=eq.'+encode(sub.id)+
      '&select=razorpay_subscription_id,plan_slug,status,cancel_at_period_end&limit=1');
  const row=rows?.[0];
  if(!row)return true;
  if(type==='subscription.charged'){
    const pay=event.payload?.payment?.entity;
    if(!PAY.test(pay?.id||''))throw error('Missing recurring payment',503);
    const verified=await razorpay('payments/'+encode(pay.id));
    if(verified.status!=='captured'||verified.subscription_id!==sub.id||
      verified.currency!=='INR'||!Number.isInteger(verified.amount))
      throw error('Recurring payment not captured',503);
    await rpc('apply_recurring_charge',{p_subscription:sub.id,p_payment:verified.id,
      p_amount:verified.amount,p_currency:verified.currency,
      p_period_end:Number.isInteger(sub.current_end)?sub.current_end:null});
    return true;
  }
  const transitions={'subscription.authenticated':'authenticated',
    'subscription.activated':'active','subscription.pending':'pending',
    'subscription.halted':'halted','subscription.cancelled':'cancelled',
    'subscription.completed':'completed'};
  const status=transitions[type];
  if(!status)return true;
  // Out-of-order authorization events must not overwrite an already paid plan.
  const eligible=status==='authenticated'?['created','authenticated']:
    ['created','authenticated','active','pending','halted'];
  if(eligible.includes(row.status)){
    await service('recurring_subscriptions?razorpay_subscription_id=eq.'+encode(sub.id)+
      '&status=in.('+eligible.join(',')+')',{
      method:'PATCH',body:{status,updated_at:new Date().toISOString(),
        ...(status==='cancelled'?{cancel_at_period_end:true}:{} )}
    });
  }
  return true;
 }
 return {configured,status,registerRoutes,handleWebhook};
}
module.exports={createRecurring,configured};
