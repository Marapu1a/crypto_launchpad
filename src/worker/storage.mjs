import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hostname } from 'node:os';
import { digest } from '../tickets/digest.mjs';

export async function withLock(path, run) {
  await mkdir(dirname(path),{recursive:true});
  const handle=await open(path,'wx');
  try {
    await handle.writeFile(JSON.stringify({pid:process.pid,host:hostname(),createdAt:new Date().toISOString()}));
    await handle.sync();return await run();
  } finally {await handle.close();await unlink(path);}
}
export async function loadState(path,identity) {
  let contents;
  try{contents=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const {checksum,...state}=JSON.parse(contents);
  if(checksum!==digest(state)||state.identity!==digest(identity)||state.schema!=='local-worker-v1')throw Error('Worker state checksum/identity mismatch');
  return state;
}
export async function saveState(path,state) {
  await mkdir(dirname(path),{recursive:true});const temp=path+'.tmp';const handle=await open(temp,'w',0o600);
  try{await handle.writeFile(JSON.stringify({...state,checksum:digest(state)},null,2));await handle.sync();}finally{await handle.close();}
  await rename(temp,path);
}

// Explicit maintenance only. Stop launchers before recovery; never infer death from age.
export async function recoverDeadLock(path) {
  let contents;try{contents=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return false;throw error;}
  const owner=JSON.parse(contents);
  if(owner.host!==hostname()||!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw Error('Unknown lock owner');
  try{process.kill(owner.pid,0);throw Error('Lock owner is still alive');}catch(error){if(error.code!=='ESRCH')throw error;}
  if(await readFile(path,'utf8')!==contents)throw Error('Lock owner changed');
  await unlink(path);return true;
}
