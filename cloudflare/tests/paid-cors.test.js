import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the Worker route in Node without loading Cloudflare-only imports.
// This checks actual Response headers and prevents regressions in job dispatch.
const source=readFileSync(new URL('../src/paid-containers.js',import.meta.url),'utf8')
  .replace("import { Container, getContainer } from '@cloudflare/containers';",
    "class Container {}; const getContainer=()=>{throw Error('Unexpected container access')};")
  .replace("import { env as secrets } from 'cloudflare:workers';","const secrets={};");
const worker=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const base='https://design-engineer-containers-v05.example.workers.dev';
const env={
  SUPABASE_URL:'https://project.example',SUPABASE_PUBLISHABLE_KEY:'publishable',
  SUPABASE_SERVICE_ROLE_KEY:'service',GITHUB_CLIENT_ID:'github-id',
  GITHUB_CLIENT_SECRET:'github-secret',ENCRYPTION_KEY:'encryption',
  BACKEND_URL:base,GATEWAY_SHARED_SECRET:'a'.repeat(64),
  BACKEND_CONTAINER:{}
};
function cors(response){
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
  for(const method of ['GET','POST','PATCH','DELETE','OPTIONS'])
    assert.match(response.headers.get('Access-Control-Allow-Methods'),new RegExp('\\b'+method+'\\b'));
  assert.match(response.headers.get('Access-Control-Allow-Headers'),/Authorization/);
  assert.match(response.headers.get('Access-Control-Allow-Headers'),/Content-Type/);
}
test('Figma Origin null OPTIONS preflight succeeds without starting API container',async()=>{
  let calls=0;
  const result=await worker.route(new Request(base+'/api/screens/implement',{
    method:'OPTIONS',headers:{Origin:'null','Access-Control-Request-Method':'POST',
    'Access-Control-Request-Headers':'authorization,content-type'}}),
    env,()=>{calls++;throw Error('Container must not start')});
  assert.equal(result.status,204);
  assert.equal(calls,0);
  cors(result);
});
test('Figma branch selection PATCH and project DELETE preflight succeed',async()=>{
  let calls=0;
  for(const method of ['PATCH','DELETE']){
    const response=await worker.route(new Request(base+'/api/projects/43bf2d85-7b38-418b-9ce1-6c04ed0a8f80',{
      method:'OPTIONS',headers:{Origin:'null','Access-Control-Request-Method':method,
      'Access-Control-Request-Headers':'authorization,content-type'}}),
      env,()=>{calls++;throw Error('Preflight must never start a container')});
    assert.equal(response.status,204);
    cors(response);
    assert(response.headers.get('Access-Control-Allow-Methods').includes(method));
  }
  assert.equal(calls,0);
});
test('Accepted queued implementation returns CORS headers and only UUID in Queue',async()=>{
  const jobId='9066285f-289b-4c89-a6d3-8ec529e0fc06';
  const messages=[];
  const mockEnv={...env,JOBS_QUEUE:{async send(payload){messages.push(payload)}}};
  const response=await worker.route(new Request(base+'/api/screens/implement',{
    method:'POST',
    headers:{Origin:'null',Authorization:'Bearer user-token','Content-Type':'application/json'},
    body:JSON.stringify({projectId:'project-id',screens:[{screen:'Login'}]})
  }),mockEnv,()=>({async fetch(req){
    assert.equal(new URL(req.url).pathname,'/api/jobs');
    assert.equal(req.headers.get('x-design-engineer-job-submit'),env.GATEWAY_SHARED_SECRET);
    return Response.json({jobId,status:'queued'},{status:201});
  }}));
  assert.equal(response.status,202);
  cors(response);
  assert.deepEqual(await response.json(),{jobId,status:'queued'});
  assert.deepEqual(messages,[{jobId}]);
});
test('Edge-generated errors and backend-proxied errors return CORS headers',async()=>{
  const noQueue=await worker.route(new Request(base+'/api/screens/implement',{
    method:'POST',headers:{Origin:'null'},body:'{}'
  }),env,()=>({fetch:()=>{throw Error('should not fetch')}}));
  assert.equal(noQueue.status,503);
  cors(noQueue);
  const missingSecret=await worker.route(new Request(base+'/api/projects',{
    headers:{Origin:'null'}
  }),{...env,GITHUB_CLIENT_SECRET:''},()=>({fetch:()=>{throw Error('should not fetch')}}));
  assert.equal(missingSecret.status,503);
  cors(missingSecret);
  const backendError=await worker.route(new Request(base+'/api/projects',{
    headers:{Origin:'null'}
  }),env,()=>({fetch:()=>Response.json({error:'Backend failed'},{status:500})}));
  assert.equal(backendError.status,500);
  cors(backendError);
  const unknown=await worker.route(new Request(base+'/',{headers:{Origin:'null'}}),env);
  assert.equal(unknown.status,404);
  cors(unknown);
});
