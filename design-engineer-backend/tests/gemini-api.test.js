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

test('Gemini file edits use output JSON schema and Gemini 3 low thinking',async()=>{
  let config;
  const output=await gemini.generate({
    apiKey:key,model:'gemini-3-flash-preview',responseJson:true,prompt:'Return file edits.',
    fetchImpl:async(url,opts)=>{
      config=JSON.parse(opts.body).generationConfig;
      return {status:200,ok:true,json:async()=>({
        candidates:[{finishReason:'STOP',content:{parts:[{text:'{"files":[{"path":"src/App.tsx","content":"export default 1"}]}'}]}}]
      })};
    }
  });
  assert(JSON.parse(output).files.length===1);
  assert.equal(config.responseMimeType,'application/json');
  assert.equal(config.responseJsonSchema.properties.files.type,'array');
  assert.equal(config.thinkingConfig.thinkingLevel,'low');
  assert.equal(config.temperature,undefined);
  assert.equal(config.maxOutputTokens,32768);
});
test('Gemini MAX_TOKENS gives retryable structured error without showing partial response',async()=>{
  await assert.rejects(gemini.generate({
    apiKey:key,model:'gemini-3-flash-preview',responseJson:true,prompt:'Return file edits.',
    fetchImpl:async()=>({status:200,ok:true,json:async()=>({
      candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{"files":['}]}}],
      usageMetadata:{candidatesTokenCount:32768}
    })})
  }),err=>err.code==='MODEL_OUTPUT_TRUNCATED'&&!err.message.includes('{"files":['));
});
test('Gemini safely retries malformed JSON using smaller context and then writes valid output',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-json-retry-'));
  try {
    const ctx=path.join(root,'.design-engineer','context');await fs.mkdir(ctx,{recursive:true});
    await fs.writeFile(path.join(ctx,'home.json'),JSON.stringify({screen:'Home',frame:'screenshot_1'}));
    await fs.mkdir(path.join(root,'src'));await fs.writeFile(path.join(root,'src','App.tsx'),'x'.repeat(20000));
    const prompts=[];
    const result=await gemini.execute({
      workspace:root,contextDir:ctx,model:'gemini-3-flash-preview',apiKey:key,
      prompt:'Implement the screen.',
      generateImpl:async args=>{
        prompts.push(args.prompt);
        if(prompts.length===1)return '{"files":[{"path":"src/Home.tsx"';
        return JSON.stringify({files:[{path:'src/Home.tsx',content:'export default function Home(){return null;}'}]});
      }
    });
    assert.equal(prompts.length,2);
    assert(prompts[1].length<prompts[0].length,'retry should reduce context');
    assert.deepEqual(result.files,['src/Home.tsx']);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('Gemini retries output truncation without writing partial files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-truncation-test-'));
  try {
    const ctx=path.join(root,'.design-engineer','context');await fs.mkdir(ctx,{recursive:true});
    let calls=0;
    await assert.rejects(gemini.execute({
      workspace:root,contextDir:ctx,model:'gemini-3-flash-preview',apiKey:key,
      prompt:'Implement the screen.',
      generateImpl:async()=>{
        calls++;
        throw new gemini.GeminiError('Truncated output', 'MODEL_OUTPUT_TRUNCATED',502);
      }
    }),err=>err.code==='MODEL_OUTPUT_TRUNCATED');
    assert.equal(calls,3);
    await assert.rejects(fs.stat(path.join(root,'src','Bad.tsx')),{code:'ENOENT'});
  }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('Gemini does not retry provider quota errors',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-provider-error-'));
  try {
    const ctx=path.join(root,'.design-engineer','context');await fs.mkdir(ctx,{recursive:true});
    let calls=0;
    await assert.rejects(gemini.execute({
      workspace:root,contextDir:ctx,model:'gemini-3-flash-preview',apiKey:key,prompt:'Implement.',
      generateImpl:async()=>{calls++;throw new gemini.GeminiError('Quota exceeded','PROVIDER_RATE_LIMIT',429)}
    }),err=>err.code==='PROVIDER_RATE_LIMIT');
    assert.equal(calls,1);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});
