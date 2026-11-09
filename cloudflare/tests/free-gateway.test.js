import test from 'node:test';
import assert from 'node:assert/strict';
import {gateway,checkOrigin} from '../src/free-gateway.js';

const WORKER='https://design-engineer-free-gateway.example.workers.dev';
const env={BACKEND_ORIGIN:'https://demo-origin.trycloudflare.com',
  GATEWAY_SHARED_SECRET:'a-random-private-32-character-secret-1234'};
test('origin validation rejects self-loops, plain HTTP and URL credentials',()=>{
 assert.equal(checkOrigin('',WORKER),null);
 assert.equal(checkOrigin('http://localhost:4000',WORKER),null);
 assert.equal(checkOrigin(WORKER,WORKER),null);
 assert.equal(checkOrigin('https://me:pass@example.com',WORKER),null);
 assert.equal(checkOrigin('https://example.com/foo',WORKER),null);
 assert.equal(checkOrigin('https://demo-origin.trycloudflare.com',WORKER),
    'https://demo-origin.trycloudflare.com');
});
test('gateway health exposes no credentials, independent of origin',async()=>{
 const r=await gateway(new Request(WORKER+'/__edge/health'),{});
 assert.equal(r.status,200);
 const json=await r.json();
 assert.equal(json.backendConfigured,false);
 assert.equal(json.authConfigured,false);
 assert(!JSON.stringify(json).includes(env.GATEWAY_SHARED_SECRET));
});
test('gateway fails closed when either required secret is missing',async()=>{
 let called=false;
 const r=await gateway(new Request(WORKER+'/auth/me'),
   {BACKEND_ORIGIN:env.BACKEND_ORIGIN},async()=>{called=true});
 assert.equal(r.status,503);assert.equal(called,false);
});
test('gateway only forwards app auth, API and health routes',async()=>{
 let called=false;
 const r=await gateway(new Request(WORKER+'/fetch-other-service'),env,
   async()=>{called=true});
 assert.equal(r.status,404);assert.equal(called,false);
});
test('gateway forwards Supabase bearer and JSON body, replaces client credential header',async()=>{
 let called=0;
 const request=new Request(WORKER+'/api/models/direct?limit=1',{
   method:'POST',headers:{Authorization:'Bearer test-jwt',
     'Content-Type':'application/json','X-Design-Engineer-Gateway':'attacker-override'},
   body:JSON.stringify({provider:'gemini',model:'gemini-2.5-flash'})
 });
 const response=await gateway(request,env,async upstream=>{
   called++;
   assert.equal(upstream.url,'https://demo-origin.trycloudflare.com/api/models/direct?limit=1');
   assert.equal(upstream.headers.get('authorization'),'Bearer test-jwt');
   assert.equal(upstream.headers.get('x-design-engineer-gateway'),env.GATEWAY_SHARED_SECRET);
   assert.deepEqual(await upstream.json(),{provider:'gemini',model:'gemini-2.5-flash'});
   return new Response(JSON.stringify({models:['gemini-2.5-flash']}),
     {status:200,headers:{'content-type':'application/json'}});
 });
 assert.equal(called,1);assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
 assert.deepEqual((await response.json()).models,['gemini-2.5-flash']);
});
test('OAuth callbacks preserve query strings without following redirects inside Worker',async()=>{
 const callback=new Request(WORKER+'/auth/github/callback?code=abc&state=def');
 const response=await gateway(callback,env,async upstream=>{
   assert.equal(new URL(upstream.url).search,'?code=abc&state=def');
   return new Response(null,{status:302,headers:{location:'https://github.com/example'}});
 });
 assert.equal(response.status,302);
 assert.equal(response.headers.get('location'),'https://github.com/example');
});
test('origin failure returns a clean 502 and never exposes origin or credentials',async()=>{
 const r=await gateway(new Request(WORKER+'/api/projects'),env,async()=>{
   throw new Error('secret '+env.GATEWAY_SHARED_SECRET);
 });
 assert.equal(r.status,502);
 const body=await r.text();
 assert(!body.includes(env.GATEWAY_SHARED_SECRET));
 assert(!body.includes(env.BACKEND_ORIGIN));
});
test('response is never cacheable, including successful backend responses',async()=>{
 const r=await gateway(new Request(WORKER+'/healthz'),env,async()=>
  new Response('OK',{headers:{'cache-control':'public, max-age=3600'}}));
 assert.equal(r.headers.get('cache-control'),'no-store, max-age=0');
});
