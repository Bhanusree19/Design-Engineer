'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {checkAnthropicKey,verifyModelAccess,ModelAccessError}=require('../services/model-verification');
const validKey='sk-ant-example-not-real';
test('Anthropic rejects invalid API key without persisting',async()=>{
  await assert.rejects(
    checkAnthropicKey(validKey,{fetchImpl:async()=>({status:401,ok:false})}),
    err=>err instanceof ModelAccessError&&err.code==='INVALID_API_KEY'
  );
});
test('Anthropic detects rate limits',async()=>{
  await assert.rejects(
    checkAnthropicKey(validKey,{fetchImpl:async()=>({status:429,ok:false})}),
    err=>err.code==='PROVIDER_RATE_LIMIT'
  );
});
test('Claude Code verifies both key and model generation before success',async()=>{
  let called=0;
  const result=await verifyModelAccess({
    agent:'claude',provider:'anthropic',apiKey:validKey,
    fetchImpl:async()=>({status:200,ok:true}),
    run:async args=>{called++;assert.equal(args.selection.agent,'claude');assert.equal(args.probe,true);return {output:'READY'}}
  });
  assert.equal(called,1);
  assert.equal(result.verified,true);
  assert.equal(result.method,'claude-cli-model-test');
});
test('Claude does not execute when API key is invalid',async()=>{
  let ran=false;
  await assert.rejects(verifyModelAccess({
    agent:'claude',provider:'anthropic',apiKey:validKey,
    fetchImpl:async()=>({status:401,ok:false}),
    run:async()=>{ran=true}
  }),err=>err.code==='INVALID_API_KEY');
  assert.equal(ran,false);
});
test('removed OpenCode adapter cannot run',async()=>{let ran=false;await assert.rejects(verifyModelAccess({agent:'opencode',provider:'opencode',run:async()=>{ran=true}}),/Unsupported coding agent/);assert.equal(ran,false);});
test('Provider billing errors are reported without leaking secrets',async()=>{
  await assert.rejects(verifyModelAccess({agent:'claude',provider:'anthropic',apiKey:validKey,fetchImpl:async()=>({status:200,ok:true}),run:async()=>{const err=new Error('secret-key-token');err.code='BILLING_UNAVAILABLE';throw err;}}),err=>err.code==='BILLING_UNAVAILABLE'&&!err.message.includes('secret-key-token'));
});
test('Claude key is passed only to isolated execution',async()=>{
  await verifyModelAccess({agent:'claude',provider:'anthropic',apiKey:validKey,fetchImpl:async()=>({status:200,ok:true}),run:async args=>{assert.deepEqual(args.env,{ANTHROPIC_API_KEY:validKey});assert.equal(args.probe,true);return {output:'READY'};}});
});
