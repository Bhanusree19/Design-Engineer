// Cloudflare Workers Free: lightweight gateway for the EXISTING Express backend.
// Node/Git/coding CLIs remain on a separate Docker/VM origin. No Containers used.
const GATEWAY_HEADER='x-design-engineer-gateway';
const NO_STORE='no-store, max-age=0';
export function checkOrigin(raw, requestUrl) {
  if(typeof raw!=='string'||!raw.trim())return null;
  try {
    const parsed=new URL(raw.trim());
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||
       parsed.pathname!=='/'||parsed.search||parsed.hash||
       parsed.host===new URL(requestUrl).host) return null;
    return parsed.origin;
  }catch{return null}
}
function textResponse(message,status){
  return new Response(JSON.stringify({error:message}),{
    status,headers:{'content-type':'application/json; charset=utf-8',
      'cache-control':NO_STORE}
  });
}
export async function gateway(request,env,fetchImpl=fetch){
  const url=new URL(request.url);
  if(url.pathname==='/__edge/health')return new Response(JSON.stringify({
    ok:true,service:'design-engineer-cloudflare-gateway',mode:'free-proxy',
    backendConfigured:!!checkOrigin(env?.BACKEND_ORIGIN,request.url),
    authConfigured:!!env?.GATEWAY_SHARED_SECRET
  }),{headers:{'content-type':'application/json','cache-control':NO_STORE}});
  const origin=checkOrigin(env?.BACKEND_ORIGIN,request.url);
  if(!origin||!env?.GATEWAY_SHARED_SECRET)
    return textResponse('Cloudflare gateway is not configured. Set BACKEND_ORIGIN and GATEWAY_SHARED_SECRET secrets.',503);
  // Only forward application routes. Never create a public generic HTTP proxy.
  const allowed=url.pathname==='/healthz'||url.pathname==='/auth'||
    url.pathname.startsWith('/auth/')||url.pathname==='/api'||url.pathname.startsWith('/api/');
  if(!allowed)return textResponse('Route not found.',404);
  const target=new URL(origin);
  target.pathname=url.pathname;target.search=url.search;
  const headers=new Headers(request.headers);
  // Client cannot override the private gateway-to-origin credential.
  headers.set(GATEWAY_HEADER,env.GATEWAY_SHARED_SECRET);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ray');
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-proto');
  const options={method:request.method,headers,redirect:'manual',
    body:['GET','HEAD'].includes(request.method)?undefined:request.body};
  try{
    const response=await fetchImpl(new Request(target.toString(),options));
    const responseHeaders=new Headers(response.headers);
    responseHeaders.set('cache-control',NO_STORE);
    responseHeaders.delete('set-cookie2');
    // Requests may contain Supabase tokens and one-time OAuth codes.
    // Never cache responses, including errors and redirects.
    return new Response(response.body,{status:response.status,
      statusText:response.statusText,headers:responseHeaders});
  }catch{
    return textResponse('Backend is unreachable. Check that the Docker backend and tunnel are running.',502);
  }
}
export default {fetch(request,env){return gateway(request,env)}};
