import React from 'react';
import {Body,ErrorBanner,Footer,Header,Rail,SuccessBanner} from '../components/Chrome';
import type {DesignEngineerActions,DesignEngineerState} from '../hooks/useDesignEngineer';
type Props={state:DesignEngineerState;actions:DesignEngineerActions};

export function readableMinutes(seconds:number):string {
  const safe=Math.max(0,Math.floor(seconds||0));
  const minutes=Math.floor(safe/60);
  const rest=safe%60;
  return minutes+'m '+String(rest).padStart(2,'0')+'s';
}

export function MinuteSummary({state,actions}:Props){
 const u=state.billing?.usage;
 if(!u)return null;
 const pct=u.allowanceSeconds?Math.min(100,Math.round(100*u.usedSeconds/u.allowanceSeconds)):100;
 return <section style={{border:'1px solid #d9dcec',borderRadius:10,padding:12,margin:'12px 0'}}>
   <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center'}}>
     <strong>{u.planName} — implementation minutes</strong>
     <button className="link" type="button" onClick={()=>void actions.openBilling()}>Plans &amp; usage</button>
   </div>
   <p style={{margin:'8px 0'}}><strong>{readableMinutes(u.remainingSeconds)}</strong> remaining of {u.allowanceSeconds/60} minutes</p>
   <div role="progressbar" aria-label="Implementation minutes consumed" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
     style={{height:7,borderRadius:6,background:'#eaecf7',overflow:'hidden'}}>
     <div style={{height:'100%',width:pct+'%',background:'#5054f5'}}/>
   </div>
   <p style={{margin:'8px 0 0',fontSize:12,color:'#62677d'}}>
     {readableMinutes(u.availableSeconds)} available for new jobs
     {u.reservedSeconds>0?' · '+readableMinutes(u.reservedSeconds)+' reserved by active jobs':''}
   </p>
 </section>;
}
export default function Billing({state,actions}:Props){
 const d=state.billing,u=d?.usage;
 return <>
  <Header state={state} actions={actions}/>
  <Rail step="billing"/>
  <Body>
   <h1>Plans &amp; implementation minutes</h1>
   <p className="lede">Your coding jobs consume real execution time. The balance refreshes automatically from the database.</p>
   {state.error&&<ErrorBanner message={state.error}/>}
   {state.notice&&<SuccessBanner>{state.notice}</SuccessBanner>}
   {u?<>
    <MinuteSummary state={state} actions={actions}/>
    {u.expiresAt&&<p className="hint">Current 30-day period ends {new Date(u.expiresAt).toLocaleDateString()}.</p>}
   </>:<p className="lede">{state.billingLoading?'Loading minutes…':'Could not load your minutes yet.'}</p>}
   <h2 style={{margin:'18px 0 10px'}}>Choose your plan</h2>
   {d?.plans?.map(plan=><div key={plan.slug} style={{border:'1px solid #dddfee',borderRadius:10,padding:14,marginBottom:10}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <strong>{plan.name}</strong>
      <strong>{plan.slug==='free'?'Free':'₹'+plan.price_inr+' / 30 days'}</strong>
    </div>
    <p style={{margin:'8px 0',color:'#596174'}}>{plan.build_minutes} implementation minutes {plan.slug==='free'?'total (one-time trial)':'per paid 30-day period'}</p>
    {plan.slug==='free'?<p className="hint">Included when you sign up. The trial does not reset monthly.</p>:
      <button type="button" className="btn btn-primary" disabled={state.billingLoading||!d.paymentsEnabled}
        onClick={()=>void actions.buyPlan(plan.slug as 'plus'|'studio')}>
        {u?.plan===plan.slug?'Renew '+plan.name:'Choose '+plan.name}
      </button>}
   </div>)}
   {d&&!d.paymentsEnabled&&<p className="hint">Paid checkout is not configured on this server.</p>}
   <p className="hint">Razorpay handles payment securely. Plans renew by manual payment every 30 days; automatic debits are not enabled. AI model provider usage is separate.</p>
  </Body>
  <Footer>
   <button className="btn btn-primary" type="button" disabled={state.billingLoading} onClick={()=>void actions.refreshBilling()}>Refresh balance</button>
   <button className="btn btn-ghost" type="button" onClick={actions.closeBilling}>Back</button>
  </Footer>
 </>;
}
