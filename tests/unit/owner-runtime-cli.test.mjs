import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve('.local/test-results/owner-runtime-boundary-'+Date.now());await fs.mkdir(root,{recursive:true});
const base={schema:'owner-rehearsal-v1',profile:{mode:'rehearsal'},rpcUrl:'http://127.0.0.1:1',urls:{admin:'postgresql://postgres@127.0.0.1:1/local'}};
for(const [name,change] of [['public mode',{profile:{mode:'production'}}],['remote RPC',{rpcUrl:'https://example.invalid'}],['remote DB',{urls:{admin:'postgresql://postgres@example.invalid/local'}}],['wrong schema',{schema:'production'}]])test('Local runtime rejects '+name+' before accessing chain or DB',async()=>{
 const file=path.join(root,name.replaceAll(' ','-')+'.json');await fs.writeFile(file,JSON.stringify({...base,...change}));const r=spawnSync(process.execPath,['scripts/rehearse-owner-token.mjs',file,'d0fb591f-29c5-467f-bfe3-fd1bbf2524f0','--serve'],{encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(r.status,1);assert.match(r.stderr,/Expected values to be strictly equal/);assert.ok(!r.stderr.includes('ECONNREFUSED'));
});
