import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const here=new URL('../',import.meta.url);
const config=JSON.parse(readFileSync(new URL('wrangler.jsonc',here),'utf8'));
const runtime=readFileSync(new URL('src/paid-containers.js',here),'utf8');
const docker=readFileSync(new URL('Dockerfile',here),'utf8');
test('Paid Worker uses one sticky Cloudflare Container and SQLite Durable Object',()=>{
 assert.equal(config.main,'src/paid-containers.js');
 assert.equal(config.containers[0].class_name,'DesignEngineerContainer');
 assert.equal(config.containers[0].instance_type,'standard-1');
 assert.equal(config.containers[0].max_instances,1);
 assert.deepEqual(config.migrations[0].new_sqlite_classes,['DesignEngineerContainer']);
 assert.equal(config.durable_objects.bindings[0].name,'BACKEND_CONTAINER');
});
test('Paid Container explicitly forwards provider secrets and isolates coding OS users',()=>{
 for(const key of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY','GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET',
  'ENCRYPTION_KEY','BACKEND_URL','GATEWAY_SHARED_SECRET']){
    assert(runtime.includes(key),key+' missing from container configuration');
 }
 assert.match(runtime,/AGENT_OS_ISOLATION:'1'/);
 assert.match(docker,/AGENT_OS_ISOLATION=1/);
 assert.match(docker,/COPY build\/backend\/ ./);
 assert(!docker.includes('ENV SUPABASE_SERVICE_ROLE_KEY='));
});
test('Paid Worker never enables public generic proxy routes',()=>{
 assert.match(runtime,/isAllowedRoute/);
 assert.match(runtime,/x-design-engineer-gateway/);
 assert(!runtime.includes('BACKEND_ORIGIN'));
});
