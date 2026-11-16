import React from 'react';
import {Body,ErrorBanner,Footer,Header,Rail,SuccessBanner} from '../components/Chrome';
import type {DesignEngineerActions,DesignEngineerState} from '../hooks/useDesignEngineer';
import type {BuildUsage,PaymentRecord} from '../../api/client';
type Props={state:DesignEngineerState;actions:DesignEngineerActions};

export function readableMinutes(seconds:number):string {
  const safe=Math.max(0,Math.floor(seconds||0));
  const minutes=Math.floor(safe/60);
  const rest=safe%60;
  return minutes+'m '+String(rest).padStart(2,'0')+'s';
}
function shortDate(iso:string|null){
  if(!iso)return '';
  const d=new Date(iso);
  return d.toLocaleDateString(undefined,{day:'numeric',month:'short'})+', '+
    d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}
const STATUS_LABEL:Record<BuildUsage['status'],string>={
  queued:'Queued',running:'Running',completed:'Completed',failed:'Failed',cancelled:'Cancelled'
};
const STATUS_COLOR:Record<BuildUsage['status'],string>={
  queued:'#62677d',running:'#5054f5',completed:'#1f8a4c',failed:'#c2352b',cancelled:'#62677d'
};
const card={border:'1px solid #d9dcec',borderRadius:10,padding:12,margin:'12px 0'} as const;
const row={display:'flex',justifyContent:'space-between',gap:10,alignItems:'baseline'} as const;
const muted={fontSize:12,color:'#62677d'} as const;

export function MinuteSummary({state,actions}:Props){
 const u=state.billing?.usage;
 if(!u)return null;
 const pct=u.allowanceSeconds?Math.min(100,Math.round(100*u.usedSeconds/u.allowanceSeconds)):100;
 const carry=u.carryoverSeconds||0;
 return <section style={card}>
   <div style={{...row,alignItems:'center'}}>
     <strong>{u.planName} — build minutes</strong>
     <button className="link" type="button" onClick={()=>void actions.openBilling()}>Plans &amp; usage</button>
   </div>
   <p style={{margin:'8px 0'}}><strong>{readableMinutes(u.remainingSeconds)}</strong> remaining of {readableMinutes(u.allowanceSeconds)}</p>
   <div role="progressbar" aria-label="Build minutes used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
     style={{height:7,borderRadius:6,background:'#eaecf7',overflow:'hidden'}}>
     <div style={{height:'100%',width:pct+'%',background:'#5054f5'}}/>
   </div>
   <p style={{...muted,margin:'8px 0 0'}}>
     {readableMinutes(u.availableSeconds)} available for new builds
     {u.reservedSeconds>0?' · '+readableMinutes(u.reservedSeconds)+' held by builds in progress':''}
   </p>
   {carry>0&&<p style={{...muted,margin:'4px 0 0'}}>
     Includes {readableMinutes(carry)} carried over from your previous period.
   </p>}
 </section>;
}

function BuildRow({b}:{b:BuildUsage}){
 const live=b.status==='running'||b.status==='queued';
 return <li style={{...row,padding:'9px 0',borderTop:'1px solid #eef0f7'}}>
   <div style={{minWidth:0}}>
     <div style={{fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
       {b.projectName||'Untitled project'}
     </div>
     <div style={muted}>
       <span style={{color:STATUS_COLOR[b.status]||'#62677d',fontWeight:600}}>{STATUS_LABEL[b.status]||b.status}</span>
       {' · '}{b.screenCount} screen{b.screenCount===1?'':'s'}{' · '}{shortDate(b.startedAt||b.createdAt)}
       {b.bucket==='free'?' · free trial':''}
     </div>
   </div>
   <strong style={{whiteSpace:'nowrap'}} title="Build minutes deducted">
     {live&&b.billedSeconds===0?'—':readableMinutes(b.billedSeconds)}{live?'…':''}
   </strong>
 </li>;
}
function PaymentRow({p}:{p:PaymentRecord}){
 return <li style={{...row,padding:'7px 0',borderTop:'1px solid #eef0f7',fontSize:12}}>
   <span style={{textTransform:'capitalize'}}>{p.planSlug} · {shortDate(p.paidAt||p.createdAt)}</span>
   <span>{p.status==='refunded'?<em style={{color:'#c2352b',marginRight:6}}>Refunded</em>:null}
     {p.currency==='INR'?'₹':p.currency+' '}{(p.amount/100).toLocaleString(undefined,{maximumFractionDigits:2})}</span>
 </li>;
}

export default function Billing({state,actions}:Props){
 const d=state.billing,u=d?.usage,h=state.billingHistory;
 const paidActive=!!u&&u.plan!=='free'&&!!u.expiresAt;
 const builds=h?.builds||[];
 const usedRecent=builds.reduce((sum,b)=>sum+(b.billedSeconds||0),0);
 return <>
  <Header state={state} actions={actions}/>
  <Rail step="billing"/>
  <Body>
   <h1>Plans &amp; build minutes</h1>
   <p className="lede">Every build is charged for the exact time it runs, to the second. Your balance updates live.</p>
   {state.error&&<ErrorBanner message={state.error}/>}
   {state.notice&&<SuccessBanner>{state.notice}</SuccessBanner>}
   {u?<>
    <MinuteSummary state={state} actions={actions}/>
    {u.expiresAt&&<p className="hint">Current 30-day period ends {new Date(u.expiresAt).toLocaleDateString()}.</p>}
   </>:<p className="lede">{state.billingLoading?'Loading minutes…':'Could not load your minutes yet.'}</p>}

   <section style={{...card,background:'#f6f7ff',borderColor:'#dcdffb'}}>
     <strong>You bring your own AI account</strong>
     <p style={{...muted,margin:'6px 0 0',fontSize:12}}>
       Build minutes pay for Design Engineer's build machine. The code itself is written by the AI account
       you connect (your ChatGPT sign-in or API key). Your AI provider bills that usage separately.
     </p>
   </section>

   <h2 style={{margin:'18px 0 10px'}}>Choose your plan</h2>
   {d?.plans?.map(plan=>{
    const current=u?.plan===plan.slug;
    const label=current?'Renew '+plan.name+' (+30 days)':
      paidActive?'Switch to '+plan.name:'Choose '+plan.name;
    return <div key={plan.slug} style={{border:'1px solid '+(current?'#5054f5':'#dddfee'),borderRadius:10,padding:14,marginBottom:10}}>
    <div style={{...row,alignItems:'center'}}>
      <strong>{plan.name}{current?' · current':''}</strong>
      <strong>{plan.slug==='free'?'Free':'₹'+plan.price_inr.toLocaleString('en-IN')+' / 30 days'}</strong>
    </div>
    <p style={{margin:'8px 0',color:'#596174'}}>{plan.build_minutes} build minutes {plan.slug==='free'?'in total (one-time trial)':'every 30 days'}</p>
    {plan.slug==='free'?<p className="hint">Included when you sign up. The trial does not reset.</p>:<>
      <button type="button" className="btn btn-primary" disabled={state.billingLoading||!d.paymentsEnabled}
        onClick={()=>void actions.buyPlan(plan.slug as 'plus'|'studio')}>{label}</button>
      {paidActive&&<p className="hint" style={{marginTop:6}}>
        {current?'Adds 30 days to your current end date. Unused minutes carry over.':
          'Starts a new 30-day period today. Your unused minutes carry over.'}
      </p>}
    </>}
   </div>})}
   {d&&!d.paymentsEnabled&&<p className="hint">Paid checkout is not configured on this server.</p>}

   <h2 style={{margin:'18px 0 4px'}}>Recent builds</h2>
   {builds.length>0&&<p style={{...muted,margin:'0 0 6px'}}>
     {readableMinutes(usedRecent)} used across your last {builds.length} build{builds.length===1?'':'s'}.
   </p>}
   {h===null?<p className="hint">{state.billingLoading?'Loading usage…':'Usage history is unavailable right now.'}</p>:
    builds.length===0?<p className="hint">No builds yet. Minutes are only used while a build runs.</p>:
    <ul style={{listStyle:'none',margin:0,padding:0}}>{builds.map(b=><BuildRow key={b.jobId} b={b}/>)}</ul>}

   {!!h?.payments?.length&&<>
    <h2 style={{margin:'18px 0 4px'}}>Payments</h2>
    <ul style={{listStyle:'none',margin:0,padding:0}}>{h.payments.map((p,i)=><PaymentRow key={i} p={p}/>)}</ul>
   </>}
   <p className="hint" style={{marginTop:14}}>Razorpay handles payment securely. Renewal is a manual payment every 30 days; there are no automatic debits. Unused minutes carry over only if you renew before your period ends.</p>
  </Body>
  <Footer>
   <button className="btn btn-primary" type="button" disabled={state.billingLoading} onClick={()=>void actions.refreshBilling()}>Refresh</button>
   <button className="btn btn-ghost" type="button" onClick={actions.closeBilling}>Back</button>
  </Footer>
 </>;
}
