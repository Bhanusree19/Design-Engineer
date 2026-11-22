'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const jobErrors=require('../services/job-errors');

test('agent auth failures become a reconnect-model message',()=>{
  const error=new Error('Coding agent failed; check sanitized worker logs');
  error.code='INVALID_API_KEY';
  const code=jobErrors.classify(error);
  assert.equal(code,'INVALID_API_KEY');
  assert.match(jobErrors.messageFor(code),/Reconnect your AI model/);
  assert.ok(jobErrors.MODEL_CODES.has(code));
});
test('known plain errors are classified without leaking their text',()=>{
  assert.equal(jobErrors.classify(new Error('Codex account must be connected first.')),'MODEL_NOT_CONNECTED');
  assert.equal(jobErrors.classify(new Error('Coding agent timed out')),'AGENT_TIMEOUT');
  assert.equal(jobErrors.classify(new Error('Saved Design Context not found for "A".')),'CONTEXT_MISSING');
  assert.equal(jobErrors.classify(new Error('fatal: could not read from remote repository')),'REPOSITORY_ACCESS');
  const unknown=jobErrors.classify(new Error('ENOENT /tmp/secret-path token=abc'));
  assert.equal(unknown,'UNKNOWN');
  assert.doesNotMatch(jobErrors.messageFor(unknown),/secret|token/);
});
test('implement responses are normalised; unknown codes fall back',()=>{
  assert.deepEqual(jobErrors.fromResponse({code:'PROVIDER_RATE_LIMIT'}).code,'PROVIDER_RATE_LIMIT');
  assert.equal(jobErrors.fromResponse({code:'<script>'}).code,'UNKNOWN');
  assert.equal(jobErrors.fromResponse(null).code,'UNKNOWN');
});
