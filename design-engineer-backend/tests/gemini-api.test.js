'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const gemini=require('../adapters/gemini-api');
const key='test-gemini-key-long-enough';
const models=[
 {name:'models/gemini-test-flash',supportedGenerationMethods:['generateContent']},
 {name:'models/not-generative',supportedGenerationMethods:['countTokens']}
];
function mockFetch({answer='READY',status=200,listed=models}={}){
 return async(url,opts)=>{
  assert.equal(opts.headers['x-goog-api-key'],key);
  assert(!url.includes(key),'API key must not appear in URL');
  return {ok:status>=200&&status<300,status,json:async()=>(
   url.includes(':generateContent')?{candidates:[{content:{parts:[{text:answer}]}}]}:{models:listed}
  )};
 };
}
test('Gemini model discovery uses authenticated official API and filters generative models',async()=>{
 const discovered=await gemini.listModels(key,{fetchImpl:mockFetch()});
 assert.deepEqual(discovered,['gemini-test-flash']);
});
test('Gemini verification makes a real model request',async()=>{
 const result=await gemini.verify({apiKey:key,model:'gemini-test-flash',fetchImpl:mockFetch()});
 assert.equal(result.verified,true);
});
test('Gemini verification rejects invalid keys and model availability',async()=>{
 await assert.rejects(gemini.verify({apiKey:key,model:'gemini-test-flash',fetchImpl:mockFetch({status:403})}),
  err=>err.code==='INVALID_API_KEY');
 await assert.rejects(gemini.verify({apiKey:key,model:'gemini-not-in-list',fetchImpl:mockFetch()}),
  err=>err.code==='MODEL_UNAVAILABLE');
});
test('Gemini adapter writes only safe files into temporary repository workspace',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-api-test-'));
 try{
  const ctx=path.join(root,'.design-engineer','context');await fs.mkdir(ctx,{recursive:true});
  await fs.writeFile(path.join(ctx,'home.json'),JSON.stringify({frame:'Home',buttons:2}));
  await fs.mkdir(path.join(root,'src'));
  await fs.writeFile(path.join(root,'package.json'),'{"name":"demo"}');
  await fs.writeFile(path.join(root,'src','App.tsx'),'export default function App(){return null}');
  let actualPrompt='';
  const result=await gemini.execute({
   workspace:root,contextDir:ctx,model:'gemini-test-flash',apiKey:key,
   prompt:'Implement home design.',
   generateImpl:async({prompt,responseJson})=>{actualPrompt=prompt;assert.equal(responseJson,true);
    return JSON.stringify({files:[{path:'src/Home.tsx',content:'export default function Home(){return null;}'}]});
   }
  });
  assert(actualPrompt.includes('Home'));
  assert(actualPrompt.includes('src/App.tsx'));
  assert.deepEqual(result.files,['src/Home.tsx']);
  assert.equal(await fs.readFile(path.join(root,'src','Home.tsx'),'utf8'),
    'export default function Home(){return null;}');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('Gemini adapter blocks path traversal and secret edits',async()=>{
 for(const file of ['../.env','/tmp/hack.js','src/../../server.js','.github/workflows/push.yml','src/.env','src/link/../../bad.ts'])
  assert.throws(()=>gemini.validateFileName(file),err=>err.code==='UNSAFE_FILE_PATH');
});
test('Gemini adapter rejects symlink paths without editing outside workspace',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-link-test-'));
 try{
  const ctx=path.join(root,'.design-engineer','context');await fs.mkdir(ctx,{recursive:true});
  await fs.symlink(os.tmpdir(),path.join(root,'src'));
  await assert.rejects(gemini.execute({
   workspace:root,contextDir:ctx,model:'gemini-test-flash',apiKey:key,prompt:'Implement.',
   generateImpl:async()=>JSON.stringify({files:[{path:'src/escape.ts',content:'bad'}]})
  }),err=>err.code==='UNSAFE_FILE_PATH');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
