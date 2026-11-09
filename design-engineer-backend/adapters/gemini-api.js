'use strict';
// Direct Gemini API adapter: no Gemini CLI and no shell commands executed.
// It performs bounded repository reads, produces structured file edits, and
// leaves existing git commit/push/PR orchestration to server.js.
const fs = require('node:fs/promises');
const path = require('node:path');

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_RESPONSE_FILES = 32;
const MAX_OUTPUT_BYTES = 240000;
const MAX_CONTEXT_BYTES = 115000;
const BLOCKED_NAMES = new Set(['.git','.env','.env.local','.env.production',
  '.npmrc','.ssh','.aws','.config','node_modules','dist','build','.next','.vercel',
  '.wrangler','.github','.gitignore','package-lock.json','yarn.lock','pnpm-lock.yaml']);
const MAX_FILE_BYTES = 32000;
const FILE_EDITS_SCHEMA = {
  type:'object',properties:{
    files:{type:'array',minItems:1,maxItems:32,items:{
      type:'object',properties:{path:{type:'string'},content:{type:'string'}},
      required:['path','content'],additionalProperties:false
    }}
  },required:['files'],additionalProperties:false
};
const MAX_GENERATION_ATTEMPTS=3;
function diagnostic(model,stage,details={}) {
  // Only log fixed metadata. Never log prompts, API keys or generated files.
  console.warn('[Design Engineer][Direct API]',JSON.stringify({
    provider:'gemini',model,stage,...details
  }));
}

class GeminiError extends Error {
  constructor(message, code='GEMINI_ERROR', status=400) {
    super(message); this.code=code; this.status=status;
  }
}
function normalizeModel(model) {
  if (typeof model !== 'string' || !/^gemini-[a-z0-9][a-z0-9._-]{1,90}$/i.test(model))
    throw new GeminiError('Choose a valid Gemini model from the model list.','MODEL_REQUIRED',400);
  return model;
}
function assertKey(apiKey) {
  if(typeof apiKey!=='string'||apiKey.length<12||apiKey.length>4096||/[\r\n\x00-\x1f]/.test(apiKey))
    throw new GeminiError('Enter a valid Gemini API key.','INVALID_KEY_FORMAT',400);
}
async function googleRequest(endpoint,apiKey,{method='GET',body,timeoutMs=15000,fetchImpl=fetch}={}) {
  assertKey(apiKey);
  let response;
  try {
    response=await fetchImpl(API_ROOT+endpoint,{
      method,
      headers:{'x-goog-api-key':apiKey,...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,
      signal:AbortSignal.timeout(timeoutMs)
    });
  }catch {
    throw new GeminiError('Gemini API is temporarily unreachable.','GEMINI_UNREACHABLE',503);
  }
  if(response.status===400)throw new GeminiError('Google rejected the request or selected model.','GEMINI_BAD_REQUEST',400);
  if(response.status===401||response.status===403)throw new GeminiError('Gemini API key was rejected or does not have access.','INVALID_API_KEY',401);
  if(response.status===402)throw new GeminiError('Gemini billing or credits are unavailable.','BILLING_UNAVAILABLE',402);
  if(response.status===404)throw new GeminiError('The chosen Gemini model is unavailable.','MODEL_UNAVAILABLE',400);
  if(response.status===429)throw new GeminiError('Gemini quota or rate limit reached.','PROVIDER_RATE_LIMIT',429);
  if(!response.ok)throw new GeminiError('Gemini request failed. Check provider status and quota.','GEMINI_UNAVAILABLE',503);
  try {return await response.json()}
  catch {throw new GeminiError('Gemini returned invalid data.','GEMINI_BAD_RESPONSE',502)}
}
async function listModels(apiKey,{fetchImpl=fetch}={}) {
  const result=await googleRequest('/models?pageSize=100',apiKey,{fetchImpl});
  return (Array.isArray(result.models)?result.models:[])
    .filter(item=>item.name?.startsWith('models/gemini-')&&
      (item.supportedGenerationMethods||[]).includes('generateContent'))
    .map(item=>item.name.slice('models/'.length))
    .filter(item=>/^gemini-[\w.-]+$/.test(item));
}
function responseText(result) {
  const candidates=result?.candidates;
  const parts=Array.isArray(candidates)&&candidates[0]?.content?.parts;
  return Array.isArray(parts)?parts.map(p=>p.text||'').join(''):'';
}
async function generate({apiKey,model,prompt,responseJson=false,timeoutMs=120000,fetchImpl=fetch}) {
  const chosen=normalizeModel(model);
  const isGemini3=/^gemini-3(?:\.|-|$)/.test(chosen);
  const config={maxOutputTokens:32768};
  // Gemini 3 models recommend the default temperature and support thinkingLevel.
  // A lower thinking level preserves more of the output budget for code.
  if(isGemini3)config.thinkingConfig={thinkingLevel:'low'};
  else config.temperature=0.15;
  if(responseJson){
    config.responseMimeType='application/json';
    config.responseJsonSchema=FILE_EDITS_SCHEMA;
  }
  const result=await googleRequest('/models/'+encodeURIComponent(chosen)+':generateContent',apiKey,{
    method:'POST',timeoutMs,fetchImpl,
    body:{
      contents:[{role:'user',parts:[{text:prompt}]}],
      generationConfig:config
    }
  });
  const candidate=result?.candidates?.[0];
  const finishReason=candidate?.finishReason||'UNKNOWN';
  const text=responseText(result);
  const bytes=Buffer.byteLength(text,'utf8');
  if(finishReason==='MAX_TOKENS'){
    diagnostic(chosen,'output_limit',{finishReason,bytes,
      outputTokens:result?.usageMetadata?.candidatesTokenCount??null});
    throw new GeminiError('Gemini reached its response token limit while generating files. Retrying with smaller context.','MODEL_OUTPUT_TRUNCATED',502);
  }
  if(['SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII'].includes(finishReason))
    throw new GeminiError('Gemini stopped generation because of a safety or content restriction.','MODEL_OUTPUT_BLOCKED',422);
  if(!text.trim())
    throw new GeminiError('Gemini returned no text for this request.','GEMINI_EMPTY_RESPONSE',502);
  if(bytes>MAX_OUTPUT_BYTES)
    throw new GeminiError('Gemini returned too much code for a single change set.','GEMINI_OUTPUT_TOO_LARGE',413);
  return text;
}

async function verify({apiKey,model,fetchImpl=fetch}) {
  normalizeModel(model);
  const models=await listModels(apiKey,{fetchImpl});
  if(!models.includes(model))throw new GeminiError('This Gemini model is not available to the supplied key.','MODEL_UNAVAILABLE',400);
  const answer=await generate({apiKey,model,prompt:'Connectivity test: respond with exactly READY.',fetchImpl,timeoutMs:25000});
  if(!answer.toUpperCase().includes('READY'))
    throw new GeminiError('Gemini did not return the expected test response.','GEMINI_BAD_RESPONSE',503);
  return {verified:true,method:'gemini-api-model-test',billingVerified:true};
}
function validateFileName(name) {
  if(typeof name!=='string'||!name||name.length>220||name.includes('\\')||
    name.startsWith('/')||name.includes('\0')||/^[a-zA-Z]:/.test(name))
    throw new GeminiError('Unsafe file path returned by Gemini.','UNSAFE_FILE_PATH');
  const parts=name.split('/');
  if(parts.some(p=>p===''||p==='.'||p==='..'||BLOCKED_NAMES.has(p)||p.startsWith('.env')))
    throw new GeminiError('Gemini tried to modify a protected path.','UNSAFE_FILE_PATH');
  if(!/\.(?:tsx?|jsx?|json|css|scss|html|md|svg|txt|yaml|yml)$/.test(name))
    throw new GeminiError('Gemini returned an unsupported file type.','UNSAFE_FILE_TYPE');
  return name;
}
async function ensureNoSymlink(workspace,relative) {
  let cursor=workspace;
  for(const segment of relative.split('/')) {
    cursor=path.join(cursor,segment);
    try {
      const stat=await fs.lstat(cursor);
      if(stat.isSymbolicLink())throw new GeminiError('Gemini attempted to use a symlink path.','UNSAFE_FILE_PATH');
    }catch(err){if(err.code==='ENOENT')break;throw err}
  }
}
async function snapshot(workspace) {
  const allowed=['src','app','pages','components','screens','public','assets','tests','test','lib','hooks'];
  const entries=[];
  let remaining=MAX_CONTEXT_BYTES;
  const walk=async(relative,depth)=>{
    if(depth>5||entries.length>=65||remaining<=0)return;
    const full=path.join(workspace,relative);
    let children;
    try{children=await fs.readdir(full,{withFileTypes:true})}catch{return}
    for(const entry of children) {
      if(entries.length>=65||remaining<=0)break;
      if(entry.isSymbolicLink()||entry.name.startsWith('.')||BLOCKED_NAMES.has(entry.name))continue;
      const child=relative?relative+'/'+entry.name:entry.name;
      if(entry.isDirectory()){await walk(child,depth+1);continue}
      if(!entry.isFile()||!/\.(?:tsx?|jsx?|json|css|scss|html|md)$/.test(child))continue;
      try{
        const data=await fs.readFile(path.join(workspace,child),'utf8');
        const excerpt=data.slice(0,Math.min(MAX_FILE_BYTES,remaining));
        remaining-=excerpt.length;
        entries.push({path:child,content:excerpt});
      }catch{}
    }
  };
  for(const item of ['package.json','README.md']) {
    try{const data=await fs.readFile(path.join(workspace,item),'utf8');
      const excerpt=data.slice(0,Math.min(10000,remaining));remaining-=excerpt.length;
      entries.push({path:item,content:excerpt})}catch{}
  }
  for(const dir of allowed)await walk(dir,1);
  return entries;
}
async function execute({workspace,contextDir,apiKey,model,prompt,generateImpl=generate}) {
  const existing=await snapshot(workspace);
  const contexts=await fs.readdir(contextDir).catch(()=>[]);
  const designs=[];
  let budget=MAX_CONTEXT_BYTES;
  for(const file of contexts.filter(f=>f.endsWith('.json')).slice(0,15)) {
    const raw=await fs.readFile(path.join(contextDir,file),'utf8');
    if(Buffer.byteLength(raw,'utf8')>budget)
      throw new GeminiError('Figma design context is too large for one direct API request.','CONTEXT_TOO_LARGE',413);
    budget-=Buffer.byteLength(raw,'utf8');
    designs.push({file,content:raw});
  }
  // Retry only malformed/truncated responses. Never retry provider auth, quota,
  // safety blocks or invalid file paths. Requests can consume API quota.
  let response;
  for(let attempt=0;attempt<MAX_GENERATION_ATTEMPTS;attempt++){
    const repoLimit=[115000,12000,4000][attempt];
    const designLimit=[115000,42000,16000][attempt];
    const repoContext=existing.map(({path:filename,content})=>({
      path:filename,content:content.slice(0,Math.max(800,Math.floor(repoLimit/Math.max(existing.length,1))))
    }));
    const designContext=designs.map(({file,content})=>({
      file,content:content.slice(0,Math.max(1800,Math.floor(designLimit/Math.max(designs.length,1))))
    }));
    const instructions=[
      'Implement the provided Figma screens in the existing repository. Preserve existing architecture and navigation.',
      'Return ONLY one valid JSON object: {"files":[{"path":"src/...","content":"complete UTF-8 file contents"}]}.',
      'Do not output markdown, shell commands, secrets, explanations, or partial JSON.',
      'Never modify .git, secrets, env files, lockfiles, or CI. Use existing project conventions.',
      'Do not claim you ran tests. Each changed file must contain its complete contents.',
      ...(attempt?['The previous attempt failed to produce a complete JSON file-edits response. You have a smaller repository summary; prioritize complete, syntactically valid file edits.']:[]),
      'IMPLEMENTATION REQUIREMENTS:\n'+prompt,
      'FIGMA DESIGN CONTEXT:\n'+JSON.stringify(designContext),
      'EXISTING REPOSITORY FILES:\n'+JSON.stringify(repoContext)
    ].join('\n\n');
    if(Buffer.byteLength(instructions,'utf8')>270000)
      throw new GeminiError('Implementation context is too large for direct API mode.','CONTEXT_TOO_LARGE',413);
    try{
      const output=await generateImpl({apiKey,model,prompt:instructions,responseJson:true});
      // JSON MIME responses usually need no cleanup. Strip only surrounding
      // Markdown fences in case a non-Gemini Direct API provider adds them.
      const cleaned=String(output).trim().replace(/^\uFEFF/,'')
        .replace(/^\`\`\`(?:json)?\s*\n?/i,'').replace(/\n?\`\`\`\s*$/,'').trim();
      try{response=JSON.parse(cleaned)}
      catch{
        throw new GeminiError('The model returned malformed or incomplete JSON file edits.','INVALID_CODE_RESPONSE',502);
      }
      // Structural failures are recoverable. Unsafe file edits are NOT.
      if(!response||!Array.isArray(response.files)||response.files.length===0||response.files.length>MAX_RESPONSE_FILES)
        throw new GeminiError('The model returned an invalid file-edits structure.','INVALID_CODE_RESPONSE',502);
      break;
    }catch(error){
      if(!['INVALID_CODE_RESPONSE','MODEL_OUTPUT_TRUNCATED','GEMINI_EMPTY_RESPONSE'].includes(error?.code))throw error;
      diagnostic(model,'retryable_response',{attempt:attempt+1,maxAttempts:MAX_GENERATION_ATTEMPTS,
        code:error.code});
      if(attempt===MAX_GENERATION_ATTEMPTS-1)throw new GeminiError(
        'Model could not return complete JSON after 3 attempts. Try a smaller Figma selection or a model with a higher output limit.',
        error.code==='MODEL_OUTPUT_TRUNCATED'?'MODEL_OUTPUT_TRUNCATED':'INVALID_CODE_RESPONSE',502);
    }
  }
  if(!Array.isArray(response.files)||response.files.length===0||response.files.length>MAX_RESPONSE_FILES)
    throw new GeminiError('Gemini returned no usable file changes.','INVALID_CODE_RESPONSE',502);
  let size=0;
  const checked=[];
  const seen=new Set();
  for(const item of response.files){
    const name=validateFileName(item.path);
    if(seen.has(name)||typeof item.content!=='string')throw new GeminiError('Invalid duplicate or empty file output.','INVALID_CODE_RESPONSE',502);
    seen.add(name);
    size+=Buffer.byteLength(item.content,'utf8');
    if(Buffer.byteLength(item.content,'utf8')>80000||size>MAX_OUTPUT_BYTES)
      throw new GeminiError('Generated files exceeded the size limit.','INVALID_CODE_RESPONSE',413);
    await ensureNoSymlink(workspace,name);
    checked.push({name,content:item.content});
  }
  for(const {name,content} of checked){
    const filename=path.join(workspace,name);
    await fs.mkdir(path.dirname(filename),{recursive:true});
    await fs.writeFile(filename,content,{flag:'w',mode:0o644});
  }
  return {files:checked.map(f=>f.name),model,agent:'gemini-api'};
}
module.exports={GeminiError,normalizeModel,assertKey,listModels,generate,verify,validateFileName,execute};
