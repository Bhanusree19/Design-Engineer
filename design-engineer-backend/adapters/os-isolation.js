'use strict';
// Linux-only defense-in-depth: each coding CLI gets a fresh Unix UID and an
// isolated temporary home/worktree. The Express process retains provider
// credentials; the coding child never inherits Supabase/GitHub server secrets.
// NOT a replacement for a separate job VM/container for hostile repositories.
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
async function grantTree(root,uid,gid,{skipGit=false}={}){
  const st=await fs.lstat(root);
  if(st.isSymbolicLink())return; // Never follow repository symlinks.
  if(skipGit&&path.basename(root)==='.git')return;
  await fs.chown(root,uid,gid);
  if(!st.isDirectory())return;
  for(const child of await fs.readdir(root)){
    await grantTree(path.join(root,child),uid,gid,{skipGit});
  }
}
async function prepare({workspace,home}){
  if(process.env.AGENT_OS_ISOLATION!=='1')return {};
  if(process.platform!=='linux'||process.getuid?.()!==0)
    throw new Error('AGENT_OS_ISOLATION requires a Linux backend running as root to drop coding-agent privileges.');
  // Never use a shared Unix UID: unrelated active jobs cannot read each
  // other's 0700 credential homes, even within the same container.
  const uid=crypto.randomInt(20000,60000);
  const gid=uid;
  const workspacePath=path.resolve(workspace);
  const homePath=path.resolve(home);
  const parent=path.dirname(workspacePath);
  // Allow traversal into a child's owned worktree without allowing reads
  // of sibling temporary folders, root-only GitHub askpass, or parent files.
  if(parent!==path.resolve(os.tmpdir())&&homePath.startsWith(parent+path.sep)){
    await fs.chmod(parent,0o711);
  }
  if(workspacePath===parent)throw new Error('Invalid coding-agent workspace');
  await grantTree(workspacePath,uid,gid,{skipGit:true});
  await grantTree(homePath,uid,gid);
  await fs.chmod(homePath,0o700);
  return {uid,gid};
}
module.exports={prepare};
