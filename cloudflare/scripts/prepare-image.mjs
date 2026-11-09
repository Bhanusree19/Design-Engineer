// Stage only backend source for Wrangler's image build context.
// Prevent accidental inclusion of .env files, credentials and node_modules.
import {cp,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..','..');
const src=path.join(root,'design-engineer-backend');
const dest=path.join(here,'..','build','backend');
const excluded=new Set(['node_modules','.git','.codex','.config','.local',
 '.env','.env.local','.env.production','sessions.json','auth.json',
 'dist','build','coverage','.npmrc']);
await stat(path.join(src,'package-lock.json'));
await rm(dest,{recursive:true,force:true});
await cp(src,dest,{
  recursive:true,
  filter:item=>{
    const name=path.basename(item);
    if(excluded.has(name)||name.startsWith('.env')||name.endsWith('.log'))return false;
    return true;
  }
});
console.log('Prepared non-secret Node backend for Cloudflare Container image build.');
