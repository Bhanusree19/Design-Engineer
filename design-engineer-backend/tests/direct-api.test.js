'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const api=require('../adapters/direct-api');
const key='this-is-a-test-api-key-123456789';
function mock(provider){
 return async(url,opts)=>{
  assert(!url.includes(key),'secret must never be included in request URL');
  if(provider==='anthropic')assert.equal(opts.headers['x-api-key'],key);
  else assert.equal(opts.headers.Authorization,'Bearer '+key);
  if(url.endsWith('/models'))return {ok:true,status:200,json:async()=>({data:[{id:provider+'-test-model'}]})};
  if(url.endsWith('/messages'))return {ok:true,status:200,json:async()=>({content:[{type:'text',text:'READY'}]})};
  if(url.endsWith('/chat/completions'))return {ok:true,status:200,
    json:async()=>({choices:[{message:{content:'READY'}}]})};
  throw new Error('Unexpected URL '+url);
 };
}
for(const provider of ['deepseek','openai','anthropic']){
 test(provider+' Direct API discovers models and verifies generation',async()=>{
  const models=await api.listModels({provider,apiKey:key,fetchImpl:mock(provider)});
  assert.deepEqual(models,[provider+'-test-model']);
  const result=await api.verify({provider,model:models[0],apiKey:key,fetchImpl:mock(provider)});
  assert.equal(result.verified,true);
 });
}
test('Only the four approved Direct API providers can be selected',()=>{
 assert.deepEqual(api.DIRECT_PROVIDERS,['gemini','deepseek','openai','anthropic']);
 for(const provider of ['evil','ollama-cloud','moonshotai'])assert.throws(()=>api.validProvider(provider));
});
test('Invalid credentials produce safe structured errors',async()=>{
 const provider='deepseek';
 await assert.rejects(api.listModels({provider,apiKey:key,
  fetchImpl:async()=>({status:401,ok:false})}),err=>err.code==='INVALID_API_KEY');
 await assert.rejects(api.listModels({provider,apiKey:key,
  fetchImpl:async()=>({status:429,ok:false})}),err=>err.code==='PROVIDER_RATE_LIMIT');
});
test('Four-provider direct API reuses safe workspace editor',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'direct-api-test-'));
 try{
  const ctx=path.join(root,'.design-engineer','context');
  await fs.mkdir(ctx,{recursive:true});
  await fs.writeFile(path.join(ctx,'frame.json'),JSON.stringify({name:'Home'}));
  for(const provider of ['deepseek','openai','anthropic']){
   const result=await api.execute({
    provider,model:provider+'-test-model',apiKey:key,workspace:root,contextDir:ctx,
    prompt:'Implement Home',generateImpl:async({provider:received,responseJson})=>{
      assert.equal(received,provider);assert.equal(responseJson,true);
      return JSON.stringify({files:[{path:'src/'+provider+'.tsx',content:'export const Home=()=>null;'}]});
    }
   });
   assert.deepEqual(result.files,['src/'+provider+'.tsx']);
  }
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
