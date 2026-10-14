import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadQianqiApiAdapters} from '../../server/adapters/qianqi/api.mjs';
import {digest} from '../../src/tickets/digest.mjs';
test('Pons API source is pinned to registry project and never falls back to old data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pons-api-')),projectId='a5897d1a-def5-4c9f-a7bb-a76f2b16519e',token='0x'+'1'.repeat(40),configHash='0x'+'a'.repeat(64);
 const config={manifest:{token},lifecycle:{vault:'0x'+'2'.repeat(40)}};
 const client={query:async()=>({rows:[{config_hash:configHash,token_address:token,chain_id:'4663'}]}),release(){}};
 const pool={connect:async()=>client};
 try{
  const ponsConfigFile=join(dir,'config.json');await writeFile(ponsConfigFile,JSON.stringify({scheduler:config}));
  const entry={projectId,configHash,source:'pons-api-v1',ponsConfigFile,publicFile:join(dir,'missing.json'),ponsConfigHash:digest(config)};
  const load=entry=>loadQianqiApiAdapters(pool,{schema:'qianqi-api-registry-v1',projects:[entry]},{handlerFactory:(_,o)=>o.reader});
  const readers=await load(entry);const data=await readers.get(projectId).read({});assert.equal(data.status,'unavailable');readers.get(projectId).close();
  await assert.rejects(load({...entry,ponsConfigHash:'wrong'}),/binding mismatch/);
  await assert.rejects(load({...entry,publicFile:'relative.json'}),/Absolute/);
  await assert.rejects(load({...entry,source:'unknown'}),/Unknown/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
