const test = require('node:test');
const assert = require('node:assert/strict');
const {validateSelection} = require('../adapters');
test('defaults to legacy Codex',()=>assert.deepEqual(validateSelection(),{agent:'codex',provider:'openai',model:null}));
test('rejects removed OpenCode adapter',()=>assert.throws(()=>validateSelection({agent:'opencode',provider:'opencode'}),/Unsupported coding agent/));
test('rejects incompatible agents',()=>assert.throws(()=>validateSelection({agent:'codex',provider:'ollama'})));
test('rejects mismatched provider',()=>assert.throws(()=>validateSelection({agent:'opencode',provider:'ollama',model:'deepseek/deepseek-chat'})));
test('rejects command-like model IDs',()=>assert.throws(()=>validateSelection({agent:'opencode',provider:'opencode',model:'; rm -rf /'})));

test('Gemini Direct API requires Gemini provider and model',()=>{
  assert.deepEqual(validateSelection({agent:'gemini-api',provider:'gemini',model:'gemini-2.5-flash'}),
    {agent:'gemini-api',provider:'gemini',model:'gemini-2.5-flash'});
  assert.throws(()=>validateSelection({agent:'gemini-api',provider:'anthropic',model:'gemini-2.5-flash'}));
  assert.throws(()=>validateSelection({agent:'gemini-api',provider:'gemini'}));
});
