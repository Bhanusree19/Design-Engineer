// Workers Paid + Containers runtime. The app and CLI binaries are installed
// inside the Cloudflare Container image, NOT on the user's desktop.
import { Container, getContainer } from '@cloudflare/containers';
import { env as secrets } from 'cloudflare:workers';

const PRIVATE_ENV_KEYS=[
  'SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','ENCRYPTION_KEY','BACKEND_URL',
  'GATEWAY_SHARED_SECRET'
];
export function missingConfig(values){
  return PRIVATE_ENV_KEYS.filter(key=>typeof values[key]!=='string'||!values[key].trim());
}
export class DesignEngineerContainer extends Container {
  defaultPort=4000;
  // Keep OAuth callbacks on the same instance while the user is authenticating.
  // Production persistence across instance restarts is a separate requirement.
  sleepAfter='20m';
  envVars={
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
    GATEWAY_SHARED_SECRET:secrets.GATEWAY_SHARED_SECRET
  };
}
export function isAllowedRoute(path){
  return path==='/healthz'||path==='/auth'||path.startsWith('/auth/')||
    path==='/api'||path.startsWith('/api/');
}
export async function route(request,env,containerFactory=(binding)=>getContainer(binding,'design-engineer-api-v05')){
  const url=new URL(request.url);
  if(url.pathname==='/__edge/health')return Response.json({
    ok:true,service:'design-engineer-cloudflare-containers',runtime:'workers-paid'
  },{headers:{'cache-control':'no-store'}});
  if(!isAllowedRoute(url.pathname))return Response.json({error:'Route not found'},{status:404});
  const missing=missingConfig(env);
  if(missing.length)return Response.json({
    error:'Cloudflare container secrets are missing: '+missing.join(', '),
    code:'CLOUDFLARE_CONFIG_MISSING'
  },{status:503});
  const headers=new Headers(request.headers);
  headers.set('x-design-engineer-gateway',env.GATEWAY_SHARED_SECRET);
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-proto');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ray');
  const forwarded=new Request(request,{headers});
  try{
    const response=await containerFactory(env.BACKEND_CONTAINER).fetch(forwarded);
    const responseHeaders=new Headers(response.headers);
    responseHeaders.set('cache-control','no-store');
    return new Response(response.body,{status:response.status,headers:responseHeaders});
  }catch(error){
    // Never expose container logs, credentials or internal errors to clients.
    console.error('[Design Engineer] Container proxy error',error?.name||'unknown');
    return Response.json({error:'Coding backend is starting or unavailable. Retry shortly.',
      code:'CONTAINER_UNAVAILABLE'},{status:503,headers:{'cache-control':'no-store'}});
  }
}
export default {fetch(request,env){return route(request,env)}};
