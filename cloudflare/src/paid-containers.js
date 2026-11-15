// Deployment 05: control-plane API Container + one execution Container per job.
// Queue messages carry ONLY a UUID; no bearer, model key, or screen context.
// The coding-agent/model selection and OpenCode free-model flow are unchanged.
import { Container, getContainer } from '@cloudflare/containers';
import { env as secrets } from 'cloudflare:workers';

const PRIVATE_ENV_KEYS=[
  'SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','ENCRYPTION_KEY','BACKEND_URL',
  'GATEWAY_SHARED_SECRET'
];
const JOB_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function missingConfig(values){
  return PRIVATE_ENV_KEYS.filter(key=>typeof values[key]!=='string'||!values[key].trim());
}
const backendEnv={
  PORT:'4000',
  NODE_ENV:'production',
  AGENT_OS_ISOLATION:'1',
  SUPABASE_URL:secrets.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY:secrets.SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY:secrets.SUPABASE_SERVICE_ROLE_KEY,
  GITHUB_CLIENT_ID:secrets.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET:secrets.GITHUB_CLIENT_SECRET,
  ENCRYPTION_KEY:secrets.ENCRYPTION_KEY,
  BACKEND_URL:secrets.BACKEND_URL,
  GATEWAY_SHARED_SECRET:secrets.GATEWAY_SHARED_SECRET,
  RAZORPAY_KEY_ID:secrets.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET:secrets.RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET:secrets.RAZORPAY_WEBHOOK_SECRET
};
export class DesignEngineerContainer extends Container {
  defaultPort=4000;
  sleepAfter='20m';
  envVars={...backendEnv,DESIGN_ENGINEER_ROLE:'api'};
}
export class DesignEngineerJobContainer extends Container {
  defaultPort=4000;
  sleepAfter='20m';
  envVars={...backendEnv,DESIGN_ENGINEER_ROLE:'job'};
}
export function isAllowedRoute(path){
  return path==='/healthz'||path==='/auth'||path.startsWith('/auth/')||
    path==='/api'||path.startsWith('/api/')||path==='/billing'||
    path.startsWith('/billing/');
}
function jsonError(message,status,code){
  return Response.json({error:message,code},{status,headers:{'cache-control':'no-store'}});
}
function toApiRequest(request,env,urlOverride){
  const headers=new Headers(request.headers);
  headers.set('x-design-engineer-gateway',env.GATEWAY_SHARED_SECRET);
  // Do not allow external callers to smuggle internal dispatch credentials.
  headers.delete('x-design-engineer-internal-job');
  headers.delete('x-design-engineer-job-submit');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ray');
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-proto');
  return new Request(urlOverride||request,{method:request.method,
    headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,
    ...(request.body?{duplex:'half'}:{})});
}
function safeResponse(response){
  const headers=new Headers(response.headers);
  headers.set('cache-control','no-store');
  return new Response(response.body,{status:response.status,headers});
}
// Figma runs plugin UI in a sandbox with Origin: null. The API is authenticated
// using Bearer tokens (not cross-origin cookies), so wildcard origin is safe
// and avoids relying on the caller-controlled Origin request header. Apply
// CORS even to errors generated at the edge, including queued-job responses.
const CORS_HEADERS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':'Authorization, Content-Type',
  'Access-Control-Max-Age':'86400'
};
function withCors(response){
  const headers=new Headers(response.headers);
  for(const [key,value] of Object.entries(CORS_HEADERS))headers.set(key,value);
  return new Response(response.body,{status:response.status,headers});
}
export async function route(request,env,apiContainer){
  // Preflight must never start a Container or create an implementation job.
  if(request.method==='OPTIONS' && isAllowedRoute(new URL(request.url).pathname))
    return withCors(new Response(null,{status:204}));
  return withCors(await routeInternal(request,env,apiContainer));
}
async function routeInternal(request,env,apiContainer=(binding)=>
  getContainer(binding,'design-engineer-api-v05')){
  const url=new URL(request.url);
  if(url.pathname==='/__edge/health')return Response.json({
    ok:true,service:'design-engineer-cloudflare-containers',runtime:'workers-paid',
    execution:'per-job-container',queueConnected:!!env.JOBS_QUEUE
  },{headers:{'cache-control':'no-store'}});
  if(!isAllowedRoute(url.pathname))return jsonError('Route not found.',404,'NOT_FOUND');
  const missing=missingConfig(env);
  if(missing.length)return jsonError(
    'Cloudflare container secrets missing: '+missing.join(', '),503,'CLOUDFLARE_CONFIG_MISSING');
  try{
    const container=apiContainer(env.BACKEND_CONTAINER);
    if(url.pathname==='/api/screens/implement'&&request.method==='POST'){
      if(!env.JOBS_QUEUE)return jsonError('Job queue is unavailable.',503,'QUEUE_UNAVAILABLE');
      // Control-plane container verifies Supabase JWT, project and screen
      // ownership and stores encrypted job credentials in development Supabase.
      const submitUrl=new URL(request.url);
      submitUrl.pathname='/api/jobs';
      const submitRequest=toApiRequest(request,env,submitUrl.toString());
      submitRequest.headers.set('x-design-engineer-job-submit',env.GATEWAY_SHARED_SECRET);
      const submitted=await container.fetch(submitRequest);
      if(!submitted.ok)return safeResponse(submitted);
      const data=await submitted.json();
      if(!JOB_ID.test(data?.jobId||''))
        return jsonError('Job record was not created.',502,'JOB_CREATE_FAILED');
      try {
        await env.JOBS_QUEUE.send({jobId:data.jobId});
      }catch {
        // A persisted job reserves paid minutes. Release that reservation
        // immediately if the Queue cannot dispatch it, instead of blocking
        // the user until the stale-job cron eventually runs.
        try{
          await fetch(new URL('/rest/v1/rpc/finish_metered_job',env.SUPABASE_URL),{
            method:'POST',
            headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,
              'Content-Type':'application/json'},
            body:JSON.stringify({p_job:data.jobId,p_status:'failed',p_result:null,
              p_error:'Queue dispatch unavailable; please retry.'})
          });
        }catch{console.warn('[Design Engineer] Deferred reservation cleanup for failed dispatch');}
        return jsonError('Queue dispatch unavailable. Please retry.',503,'JOB_DISPATCH_FAILED');
      }
      return Response.json({jobId:data.jobId,status:'queued'},{status:202,
        headers:{'cache-control':'no-store'}});
    }
    return safeResponse(await container.fetch(toApiRequest(request,env)));
  }catch(error){
    console.error('[Design Engineer] API container proxy error',error?.name||'unknown');
    return jsonError('Backend is starting or unavailable. Retry shortly.',503,'CONTAINER_UNAVAILABLE');
  }
}
export async function consume(batch,env,jobContainer=(binding,id)=>getContainer(binding,id)){
  for(const message of batch.messages){
    const jobId=message.body?.jobId;
    if(!JOB_ID.test(jobId||'')){
      message.ack();
      continue;
    }
    if(missingConfig(env).length){
      message.retry({delaySeconds:30});
      continue;
    }
    try {
      // Unique Durable Object ID -> isolated Cloudflare Container instance.
      // Each message starts its OWN container; no global running-job lock.
      const url=new URL('/internal/jobs/execute',env.BACKEND_URL);
      const dispatched=await jobContainer(env.JOB_CONTAINER,'job-'+jobId).fetch(
        new Request(url.toString(),{method:'POST',
          headers:{'Content-Type':'application/json',
            'x-design-engineer-gateway':env.GATEWAY_SHARED_SECRET,
            'x-design-engineer-internal-job':env.GATEWAY_SHARED_SECRET},
          body:JSON.stringify({jobId})
        })
      );
      if(!dispatched.ok)throw new Error('Job container could not accept dispatch');
      message.ack();
    }catch(error){
      console.warn('[Design Engineer] Job dispatch retry',error?.name||'unknown');
      message.retry({delaySeconds:30});
    }
  }
}
// Reconcile expired queued/running jobs via the SAME transactional RPC as
// normal job termination. A raw UPDATE would strand quota reservations.
export async function reconcileStaleJobs(env,fetchImpl=fetch){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return;
  const key=env.SUPABASE_SERVICE_ROLE_KEY;
  const base=new URL('/rest/v1/implementation_jobs',env.SUPABASE_URL).toString();
  const auth={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
  for(const [status,field,ageMinutes] of [
    ['running','started_at',35],
    ['queued','created_at',50]
  ]){
    const cutoff=new Date(Date.now()-ageMinutes*60000).toISOString();
    const lookup=base+'?status=eq.'+status+'&'+field+'=lt.'+
      encodeURIComponent(cutoff)+'&select=id&limit=100';
    const records=await fetchImpl(lookup,{headers:auth});
    if(!records.ok){
      console.warn('[Design Engineer] Cannot inspect expired jobs',status,records.status);
      continue;
    }
    for(const job of await records.json()){
      if(!JOB_ID.test(job?.id||''))continue;
      const final=await fetchImpl(new URL('/rest/v1/rpc/finish_metered_job',
        env.SUPABASE_URL).toString(),{method:'POST',headers:auth,
        body:JSON.stringify({p_job:job.id,p_status:'failed',p_result:null,
          p_error:status==='queued'?'Job expired in queue. Please approve again.':
            'Job timed out. Please approve again.'})});
      if(!final.ok)console.warn('[Design Engineer] Cannot finalize expired job',final.status);
    }
  }
}
export default {
  fetch(request,env){return route(request,env)},
  queue(batch,env){return consume(batch,env)},
  scheduled(controller,env,ctx){ctx.waitUntil(reconcileStaleJobs(env))}
};
