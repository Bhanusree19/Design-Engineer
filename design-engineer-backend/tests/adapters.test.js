const test = require('node:test');
const assert = require('node:assert/strict');
const {validateSelection} = require('../adapters');
test('defaults to legacy Codex',()=>assert.deepEqual(validateSelection(),{agent:'codex',provider:'openai',model:null}));
test('allows OpenCode free-model selection',()=>assert.equal(validateSelection({agent:'opencode',provider:'opencode',model:'opencode/big-pickle'}).agent,'opencode'));
test('allows cloud-provider models',()=>assert.equal(validateSelection({agent:'opencode',provider:'deepseek',model:'deepseek/deepseek-chat'}).provider,'deepseek'));
test('rejects incompatible agents',()=>assert.throws(()=>validateSelection({agent:'codex',provider:'ollama'})));
test('rejects mismatched provider',()=>assert.throws(()=>validateSelection({agent:'opencode',provider:'ollama',model:'deepseek/deepseek-chat'})));
test('rejects command-like model IDs',()=>assert.throws(()=>validateSelection({agent:'opencode',provider:'opencode',model:'; rm -rf /'})));
