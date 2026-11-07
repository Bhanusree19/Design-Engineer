'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {checkAnthropicKey,verifyModelAccess,ModelAccessError}=require('../services/model-verification');
const validKey='sk-ant-example-not-real';
const freeModel={agent:'opencode',provider:'opencode',model:'opencode/big-pickle'};
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
    run:async args=>{called++;assert.equal(args.selection.agent,'claude');assert.equal(args.probe,true)}
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
test('OpenCode free model can be probed without an API key',async()=>{
  const result=await verifyModelAccess({...freeModel,run:async args=>{
    assert.deepEqual(args.env,{});
    assert.equal(args.probe,true);
    assert.equal(args.selection.model,'opencode/big-pickle');
  }});
  assert.equal(result.verified,true);
});
test('OpenCode free model auth failures ask for account connection',async()=>{
  await assert.rejects(
    verifyModelAccess({...freeModel,run:async()=>{
      const err=new Error('Coding agent failed');
      err.code='INVALID_API_KEY';throw err;
    }}),err=>err.code==='INVALID_API_KEY'
  );
});
test('OpenCode paid providers require key',async()=>{
  await assert.rejects(verifyModelAccess({
    agent:'opencode',provider:'deepseek',model:'deepseek/deepseek-chat',run:async()=>{}
  }),err=>err.code==='CONNECTION_REQUIRED');
});
test('OpenCode paid provider passes key only to isolated process environment',async()=>{
  const result=await verifyModelAccess({
    agent:'opencode',provider:'deepseek',model:'deepseek/deepseek-chat',
    apiKey:'example-secret-key',run:async args=>{
      assert.deepEqual(args.env,{DEEPSEEK_API_KEY:'example-secret-key'});
      assert.equal(args.probe,true);
    }
  });
  assert.equal(result.verified,true);
});
test('Provider billing errors are reported without leaking secrets',async()=>{
  await assert.rejects(verifyModelAccess({
    ...freeModel,run:async()=>{const err=new Error('secret-key-token');err.code='BILLING_UNAVAILABLE';throw err;}
  }),err=>err.code==='BILLING_UNAVAILABLE'&&!err.message.includes('secret-key-token'));
});
