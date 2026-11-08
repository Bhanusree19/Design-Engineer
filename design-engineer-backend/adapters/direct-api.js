'use strict';
// Common direct-API provider registry. This module only calls allowlisted
// provider HTTPS origins; user input never selects request host or URL.
// The shared workspace adapter handles validated file changes.
const gemini=require('./gemini-api');
const DIRECT_PROVIDERS=Object.freeze(['gemini','deepseek','openai','anthropic']);
const BASE_URL=Object.freeze({
  deepseek:'https://api.deepseek.com',
  openai:'https://api.openai.com/v1',
  anthropic:'https://api.anthropic.com/v1'
});
class DirectApiError extends Error {
  constructor(message,code='DIRECT_API_ERROR',status=400){
    super(message);this.code=code;this.status=status;
  }
}
function validProvider(provider){
  if(!DIRECT_PROVIDERS.includes(provider))
    throw new DirectApiError('Choose Gemini, DeepSeek, OpenAI or Anthropic.','INVALID_PROVIDER',400);
  return provider;
}
function validModel(model){
  if(typeof model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,140}$/.test(model))
    throw new DirectApiError('Choose a valid model from this provider.','MODEL_REQUIRED',400);
  return model;
}
function validKey(key){
  if(typeof key!=='string'||key.length<12||key.length>4096||/[\r\n\x00-\x1f]/.test(key))
    throw new DirectApiError('Enter a valid API key.','INVALID_API_KEY_FORMAT',400);
  return key;
}
async function request(provider, endpoint,apiKey,{method='GET',body,fetchImpl=fetch,timeoutMs=20000}={}){
  validProvider(provider);validKey(apiKey);
  if(provider==='gemini')throw new DirectApiError('Use Gemini API adapter.','INTERNAL_ERROR',500);
  let result;
  const headers=provider==='anthropic'?
    {'x-api-key':apiKey,'anthropic-version':'2023-06-01'}:
    {Authorization:'Bearer '+apiKey};
  try{
    result=await fetchImpl(BASE_URL[provider]+endpoint,{
      method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)
    });
  }catch{throw new DirectApiError('The provider could not be reached.','PROVIDER_UNREACHABLE',503)}
  const status=result.status;
  if(status===401||status===403)throw new DirectApiError('Provider rejected the API key or access permission.','INVALID_API_KEY',401);
  if(status===402)throw new DirectApiError('Provider account has insufficient billing or credits.','BILLING_UNAVAILABLE',402);
  if(status===404)throw new DirectApiError('Selected model or API endpoint is unavailable.','MODEL_UNAVAILABLE',400);
  if(status===429)throw new DirectApiError('Provider rate limit or quota reached.','PROVIDER_RATE_LIMIT',429);
  if(status===400)throw new DirectApiError('Provider rejected the model or request. Check model access and limits.','INVALID_MODEL_REQUEST',400);
  if(!result.ok)throw new DirectApiError('Provider request failed. Check its status and your model access.','PROVIDER_UNAVAILABLE',503);
  try{return await result.json()}catch{throw new DirectApiError('Provider returned an invalid response.','INVALID_PROVIDER_RESPONSE',502)}
}
async function listModels({provider,apiKey,fetchImpl=fetch}){
  validProvider(provider);validKey(apiKey);
  if(provider==='gemini')return gemini.listModels(apiKey,{fetchImpl});
  const data=await request(provider,'/models',apiKey,{fetchImpl});
  const models=Array.isArray(data.data)?data.data:[];
  return models.map(item=>item.id).filter(id=>typeof id==='string'&&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,140}$/.test(id)).slice(0,200);
}
function extractText(provider,data){
  if(provider==='anthropic')return (data.content||[]).filter(p=>p.type==='text').map(p=>p.text||'').join('');
  return data.choices?.[0]?.message?.content||'';
}
async function generate({provider,model,apiKey,prompt,responseJson=false,timeoutMs=120000,fetchImpl=fetch}){
  validProvider(provider);validModel(model);validKey(apiKey);
  if(provider==='gemini')return gemini.generate({apiKey,model,prompt,responseJson,timeoutMs,fetchImpl});
  const body=provider==='anthropic'?
    {model,max_tokens:8192,messages:[{role:'user',content:prompt}]}:
    {model,messages:[{role:'user',content:prompt}],max_completion_tokens:8192,
      ...(responseJson?{response_format:{type:'json_object'}}:{})};
  // DeepSeek supports max_tokens instead of max_completion_tokens.
  if(provider==='deepseek'){body.max_tokens=8192;delete body.max_completion_tokens;}
  const endpoint=provider==='anthropic'?'/messages':'/chat/completions';
  const data=await request(provider,endpoint,apiKey,{method:'POST',body,fetchImpl,timeoutMs});
  const output=extractText(provider,data);
  if(typeof output!=='string'||!output.trim())
    throw new DirectApiError('Model did not return text.','EMPTY_MODEL_RESPONSE',502);
  if(Buffer.byteLength(output,'utf8')>240000)
    throw new DirectApiError('Model response is too large for one code change.','MODEL_RESPONSE_TOO_LARGE',413);
  return output;
}
async function verify({provider,model,apiKey,fetchImpl=fetch}){
  validProvider(provider);validModel(model);validKey(apiKey);
  const models=await listModels({provider,apiKey,fetchImpl});
  if(!models.includes(model))
    throw new DirectApiError('This model is not available for the selected provider and key.','MODEL_UNAVAILABLE',400);
  const output=await generate({
    provider,model,apiKey,prompt:'Connection check. Reply exactly READY.',
    timeoutMs:25000,fetchImpl
  });
  if(!output.toUpperCase().includes('READY'))
    throw new DirectApiError('Model did not return the expected verification response.','MODEL_VERIFICATION_FAILED',503);
  return {verified:true,method:provider+'-direct-api-model-test',billingVerified:true};
}
async function execute({provider,model,apiKey,workspace,contextDir,prompt,generateImpl=generate}){
  validProvider(provider);validModel(model);
  // Reuse Gemini's bounded repository snapshot and safe file-application
  // engine for ALL direct API providers; only the model request differs.
  return gemini.execute({
    apiKey,model,workspace,contextDir,prompt,
    generateImpl:args=>generateImpl({...args,provider})
  });
}
module.exports={DIRECT_PROVIDERS,DirectApiError,validProvider,validModel,listModels,generate,verify,execute};
