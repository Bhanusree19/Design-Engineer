'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const agents = ['codex', 'claude', 'opencode'];
const providers = ['opencode', 'ollama-cloud', 'deepseek', 'moonshotai', 'openai', 'anthropic'];
const binaries = {
  codex: process.env.CODEX_BIN || path.join(__dirname, '..', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  claude: process.env.CLAUDE_BIN || 'claude',
  opencode: process.env.OPENCODE_BIN || 'opencode'
};
function validateSelection({agent = 'codex', provider, model = null} = {}) {
  if (!agents.includes(agent)) throw new Error('Unsupported coding agent');
  provider ||= agent === 'codex' ? 'openai' : agent === 'claude' ? 'anthropic' : 'opencode';
  if (agent === 'codex' && provider !== 'openai') throw new Error('Codex requires OpenAI');
  if (agent === 'claude' && provider !== 'anthropic') throw new Error('Claude Code requires Anthropic');
  if (agent === 'opencode' && !providers.includes(provider)) throw new Error('Unsupported OpenCode model provider');
  if (model != null && (typeof model !== 'string' || !/^[a-zA-Z0-9][\w./:+@-]{0,150}$/.test(model))) throw new Error('Invalid model identifier');
  if (agent === 'opencode' && model && !model.includes('/')) throw new Error('OpenCode model IDs use provider/model syntax');
  if (agent === 'opencode' && model && model.split('/')[0] !== provider) throw new Error('Model provider does not match selection');
  return {agent, provider, model};
}
async function execute({selection, workspace, prompt, home, env = {}, timeoutMs = 900000, onOutput = () => {}}) {
  const {agent, model} = validateSelection(selection);
  if (!path.isAbsolute(workspace) || !path.isAbsolute(home)) throw new Error('Absolute workspace and isolated home required');
  await fs.promises.mkdir(home, {recursive:true, mode:0o700});
  // OpenCode's provider configuration references the secret environment variable
  // rather than storing an API key in the worktree or configuration file.
  if (agent === 'opencode' && selection.provider !== 'opencode') {
    const keys={'ollama-cloud':'OLLAMA_API_KEY',deepseek:'DEEPSEEK_API_KEY',
      moonshotai:'MOONSHOT_API_KEY',openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY'};
    const key=keys[selection.provider];
    if (!key || !env[key]) throw new Error('Selected provider API key not configured');
    const dir=path.join(home,'.config','opencode');
    await fs.promises.mkdir(dir,{recursive:true,mode:0o700});
    const config={providers:{[selection.provider]:{settings:{apiKey:'{env:'+key+'}'}}}};
    await fs.promises.writeFile(path.join(dir,'opencode.json'),JSON.stringify(config),{mode:0o600});
  }
  const argv = agent === 'codex'
    ? ['exec', '--cd', workspace, ...(model ? ['--model',model] : []), prompt]
    : agent === 'claude'
      ? ['-p', prompt, '--max-turns', '60', ...(model ? ['--model',model] : [])]
      : ['run', ...(model ? ['--model',model] : []), prompt];
  const command = agent === 'codex' ? process.execPath : binaries[agent];
  if (agent === 'codex') argv.unshift(binaries.codex);
  // Do not inherit GitHub OAuth, Supabase or other user secrets from the API server.
  const safeEnv = { PATH:process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME:home,
    CODEX_HOME:path.join(home,'.codex'), XDG_CONFIG_HOME:path.join(home,'.config'),
    XDG_DATA_HOME:path.join(home,'.local','share'), ...env };
  return await new Promise((resolve,reject)=>{
    const child = spawn(command, argv, {cwd:workspace, env:safeEnv, stdio:['ignore','pipe','pipe']});
    let done=false, output='';
    const finish=(err)=>{if(done)return;done=true;clearTimeout(timer);err?reject(err):resolve({agent,model,output});};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('Coding agent timed out'));},timeoutMs);
    child.on('error',finish);
    for (const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{
      const line=chunk.toString();output=(output+line).slice(-32768);onOutput(line);
    });
    child.on('close',code=>finish(code===0?null:new Error('Coding agent failed; check sanitized worker logs')));
  });
}
module.exports={agents,providers,validateSelection,execute};
