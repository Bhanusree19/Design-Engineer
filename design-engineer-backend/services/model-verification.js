'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execute,validateSelection,keyEnvByProvider}=require('../adapters');

class ModelAccessError extends Error {
  constructor(message,code='MODEL_ACCESS_FAILED',status=400) {
    super(message);this.code=code;this.status=status;
  }
}
function sanitizedError(error) {
  if(error instanceof ModelAccessError)return error;
  const code=error?.code;
  if(code==='INVALID_API_KEY')return new ModelAccessError('Authentication failed. Check or reconnect your API key or OpenCode account.','INVALID_API_KEY',401);
  if(code==='BILLING_UNAVAILABLE')return new ModelAccessError('The provider reports insufficient credits or billing access.','BILLING_UNAVAILABLE',402);
  if(code==='PROVIDER_RATE_LIMIT')return new ModelAccessError('The provider rate limit has been reached.','PROVIDER_RATE_LIMIT',429);
  if(code==='MODEL_UNAVAILABLE')return new ModelAccessError('That model is not available for the selected provider.','MODEL_UNAVAILABLE',400);
  const message=String(error?.message||'').toLowerCase();
  if(/timed out|timeout/.test(message))return new ModelAccessError('The model connection timed out. Try again.','PROBE_TIMEOUT',504);
  if(/enoent|not found|spawn.*error/.test(message))return new ModelAccessError('The coding CLI is not installed in the backend.','CLI_UNAVAILABLE',503);
  return new ModelAccessError('The model could not be reached. Check the provider connection, model availability, credits and rate limits.','MODEL_ACCESS_FAILED',503);
}
function assertProviderKey(provider,key) {
  if(typeof key!=='string'||key.length<8||key.length>4096||/[\r\n\x00-\x1f]/.test(key))
    throw new ModelAccessError('Enter a valid API key.','INVALID_KEY_FORMAT',400);
  if(!keyEnvByProvider[provider])throw new ModelAccessError('Unsupported provider.','UNSUPPORTED_PROVIDER',400);
}
// Anthropic official model list checks API key without incurring a paid completion.
// Successful authentication does not guarantee billing or model availability.
async function checkAnthropicKey(key,{fetchImpl=fetch,timeoutMs=12000}={}) {
  assertProviderKey('anthropic',key);
  let response;
  try {
    response=await fetchImpl('https://api.anthropic.com/v1/models?limit=1',{
      method:'GET',
      headers:{'x-api-key':key,'anthropic-version':'2023-06-01'},
      signal:AbortSignal.timeout(timeoutMs)
    });
  } catch(e) {throw new ModelAccessError('Anthropic verification is temporarily unavailable.','PROVIDER_UNREACHABLE',503)}
  if(response.status===401||response.status===403)throw new ModelAccessError('Anthropic rejected this API key.','INVALID_API_KEY',401);
  if(response.status===429)throw new ModelAccessError('Anthropic is rate-limiting verification. Please retry.','PROVIDER_RATE_LIMIT',429);
  if(!response.ok)throw new ModelAccessError('Anthropic could not validate this API key right now.','PROVIDER_UNAVAILABLE',503);
  return {verified:true,method:'anthropic-model-list',billingVerified:false};
}
async function verifyModelAccess({agent,provider,model,apiKey,run=execute,fetchImpl=fetch,timeoutMs=30000}={}) {
  const selection=validateSelection({agent,provider,model});
  if(selection.agent==='codex')throw new ModelAccessError('Use the existing Codex connection flow.','USE_CODEX_AUTH',400);
  if(selection.agent==='claude'&&!apiKey)throw new ModelAccessError('An Anthropic API key is required.','CONNECTION_REQUIRED',401);
  if(selection.agent==='opencode'&&!selection.model)
    throw new ModelAccessError('Choose a model before verifying its connection.','MODEL_REQUIRED',400);
  if(apiKey)assertProviderKey(selection.provider,apiKey);
  if(selection.agent==='opencode'&&selection.provider!=='opencode'&&!apiKey)
    throw new ModelAccessError('Connect your provider API key first.','CONNECTION_REQUIRED',401);
  // Validate Anthropic credentials first without incurring model usage.
  // Then run a tiny CLI completion to also check billing and actual execution.
  if(selection.agent==='claude')
    await checkAnthropicKey(apiKey,{fetchImpl});
  // Probe a single response with the exact model. This may incur a very small
  // provider charge; the user explicitly initiates it from Connect/Continue.
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'design-engineer-model-test-'));
  try {
    const env=apiKey?{[keyEnvByProvider[selection.provider]]:apiKey}:{};
    const result=await run({
      selection,
      workspace:root,
      home:path.join(root,'auth'),
      env,
      timeoutMs,
      probe:true,
      prompt:'Connectivity check only. Reply exactly READY. Do not use tools, run commands, read files or modify files.'
    });
    if(!String(result?.output||'').toUpperCase().includes('READY'))
      throw new ModelAccessError('The provider returned no expected verification response. Please check the model and account.','UNEXPECTED_MODEL_RESPONSE',503);
    return {selection,verified:true,method:selection.agent+'-cli-model-test',billingVerified:true};
  }catch(error) {throw sanitizedError(error)}
  finally{await fs.promises.rm(root,{recursive:true,force:true})}
}
module.exports={ModelAccessError,assertProviderKey,checkAnthropicKey,verifyModelAccess};
