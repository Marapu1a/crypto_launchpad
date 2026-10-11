import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve('.local/test-results/draw-runtime-boundary-'+Date.now());await fs.mkdir(root,{recursive:true});
const base={schema:'owner-rehearsal-v2',profile:{mode:'rehearsal'},rpcUrl:'http://127.0.0.1:1',urls:{admin:'postgresql://postgres@127.0.0.1:1/local'}};
for(const [name,change] of [['public mode',{profile:{mode:'production'}}],['remote RPC',{rpcUrl:'https://example.invalid'}],['remote DB',{urls:{admin:'postgresql://postgres@example.invalid/local'}}],['wrong schema',{schema:'production'}],['legacy owner schema',{schema:'owner-rehearsal-v1'}]])test('Local v2 runtime rejects '+name+' before accessing chain or DB',async()=>{
 const file=path.join(root,name.replaceAll(' ','-')+'.json');await fs.writeFile(file,JSON.stringify({...base,...change}));const r=spawnSync(process.execPath,['scripts/rehearse-owner-draw.mjs',file,'d0fb591f-29c5-467f-bfe3-fd1bbf2524f0','--serve'],{encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(r.status,1);assert.match(r.stderr,/Expected values to be strictly equal/);assert.ok(!r.stderr.includes('ECONNREFUSED'));
});
