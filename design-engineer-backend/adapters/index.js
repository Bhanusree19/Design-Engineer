'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const osIsolation = require('./os-isolation');

const agents = ['codex', 'claude', 'opencode', 'gemini-api', 'direct-api'];
const providers = ['opencode', 'ollama-cloud', 'deepseek', 'moonshotai', 'openai', 'anthropic', 'gemini'];
const binaries = {
  codex: process.env.CODEX_BIN || path.join(__dirname, '..', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  claude: process.env.CLAUDE_BIN || 'claude',
  opencode: process.env.OPENCODE_BIN || 'opencode'
};
function validateSelection({agent = 'codex', provider, model = null} = {}) {
  if (!agents.includes(agent)) throw new Error('Unsupported coding agent');
  provider ||= agent === 'codex' ? 'openai' : agent === 'claude' ? 'anthropic' : agent === 'gemini-api' ? 'gemini' : agent === 'direct-api' ? undefined : 'opencode';
  if (agent === 'codex' && provider !== 'openai') throw new Error('Codex requires OpenAI');
  if (agent === 'claude' && provider !== 'anthropic') throw new Error('Claude Code requires Anthropic');
  if (agent === 'gemini-api' && provider !== 'gemini') throw new Error('Gemini Direct API requires Gemini provider');
  if (agent === 'gemini-api' && (!model || !/^gemini-[a-z0-9][a-z0-9._-]{1,90}$/i.test(model))) throw new Error('Select a valid Gemini model');
  if (agent === 'direct-api' && !['gemini','deepseek','openai','anthropic'].includes(provider))
    throw new Error('Direct API supports only Gemini, DeepSeek, OpenAI and Anthropic');
  if (agent === 'direct-api' && (!model || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,140}$/.test(model)))
    throw new Error('Choose a valid Direct API model');
  if (agent === 'opencode' && !providers.includes(provider)) throw new Error('Unsupported OpenCode model provider');
  if (model != null && (typeof model !== 'string' || !/^[a-zA-Z0-9][\w./:+@-]{0,150}$/.test(model))) throw new Error('Invalid model identifier');
  if (agent === 'opencode' && model && !model.includes('/')) throw new Error('OpenCode model IDs use provider/model syntax');
  if (agent === 'opencode' && model && model.split('/')[0] !== provider) throw new Error('Model provider does not match selection');
  return {agent, provider, model};
}
const keyEnvByProvider = Object.freeze({
  opencode: 'OPENCODE_API_KEY',
  'ollama-cloud': 'OLLAMA_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  moonshotai: 'MOONSHOT_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
});
async function configureOpenCode({selection,home,env}) {
  if (selection.agent !== 'opencode') return;
  const key=keyEnvByProvider[selection.provider];
  if (selection.provider !== 'opencode' && (!key || !env[key])) {
    throw new Error('Connect the model provider before using this model.');
  }
  // Official OpenCode provider config uses "provider" and "options", not
  // "providers"/"settings". Only reference env var names, never store key values.
  const config={ $schema:'https://opencode.ai/config.json' };
  if (env[key]) {
    config.provider={ [selection.provider]: { options: { apiKey:'{env:'+key+'}' } } };
  }
  const dir=path.join(home,'.config','opencode');
  await fs.promises.mkdir(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'opencode.json');
  await fs.promises.writeFile(file,JSON.stringify(config),{mode:0o600});
  return file;
}
async function execute({selection, workspace, prompt, home, env = {}, timeoutMs = 900000, probe = false, onOutput = () => {}}) {
  const {agent, model} = validateSelection(selection);
  if (!path.isAbsolute(workspace) || !path.isAbsolute(home)) throw new Error('Absolute workspace and isolated home required');
  await fs.promises.mkdir(home, {recursive:true, mode:0o700});
  await configureOpenCode({selection,home,env});
  const identity=await osIsolation.prepare({workspace,home});
  const argv = agent === 'codex'
    ? ['exec', '--cd', workspace, ...(model ? ['--model',model] : []), prompt]
    : agent === 'claude'
      ? ['-p', prompt, '--max-turns', probe ? '1' : '60',
        ...(probe ? ['--permission-mode','plan'] : []),
        ...(model ? ['--model',model] : [])]
      : ['run', ...(probe ? ['--agent','plan'] : []),
         ...(model ? ['--model',model] : []), prompt];
  const command = agent === 'codex' ? process.execPath : binaries[agent];
  if (agent === 'codex') argv.unshift(binaries.codex);
  // Do not inherit GitHub OAuth, Supabase or other user secrets from the API server.
  const safeEnv = { PATH:process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME:home,
    CODEX_HOME:path.join(home,'.codex'), XDG_CONFIG_HOME:path.join(home,'.config'),
    XDG_DATA_HOME:path.join(home,'.local','share'), ...env };
  return await new Promise((resolve,reject)=>{
    const child = spawn(command, argv, {cwd:workspace, env:safeEnv,
      ...identity, detached:process.platform==='linux', stdio:['ignore','pipe','pipe']});
    let done=false, output='';
    const finish=(err)=>{if(done)return;done=true;clearTimeout(timer);
      // Terminate leftover background children in this job's process group.
      if(process.platform==='linux' && child.pid)try{process.kill(-child.pid,'SIGKILL')}catch{}
      err?reject(err):resolve({agent,model,output});};
    const timer=setTimeout(()=>{finish(new Error('Coding agent timed out'));},timeoutMs);
    child.on('error',finish);
    for (const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{
      const line=chunk.toString();output=(output+line).slice(-32768);onOutput(line);
    });
    child.on('close',code=>{
      if(code===0) return finish(null);
      const failure=new Error('Coding agent failed; check sanitized worker logs');
      if(/(?:401|403|unauthorized|invalid.api.key|authentication.required|not.authenticated)/i.test(output))
        failure.code='INVALID_API_KEY';
      else if(/(?:402|insufficient.credits|insufficient.quota|billing.required|payment.required)/i.test(output))
        failure.code='BILLING_UNAVAILABLE';
      else if(/(?:429|rate.limit|too.many.requests)/i.test(output))
        failure.code='PROVIDER_RATE_LIMIT';
      else if(/(?:unknown.model|model.not.found|invalid.model)/i.test(output))
        failure.code='MODEL_UNAVAILABLE';
      return finish(failure);
    });
  });
}
module.exports={agents,providers,keyEnvByProvider,configureOpenCode,validateSelection,execute};
