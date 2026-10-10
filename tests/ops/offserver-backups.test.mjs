import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {archiveTime,inspectBackup} from '../../ops/watchdog/backups.mjs';

const now=Date.parse('2026-10-10T06:00:00Z');
function fixture(t,kind='native',name='20261010T040000Z.tar.gz'){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'offserver-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const bytes=Buffer.from('isolated archive fixture'),checksum=createHash('sha256').update(bytes).digest('hex');
 fs.writeFileSync(path.join(directory,name),bytes);
 fs.writeFileSync(path.join(directory,kind==='native'?name.replace('.tar.gz','.sha256'):name+'.sha256'),checksum+'  '+name+'\n');
 const status={status:'VERIFIED',observedAt:new Date(now).toISOString(),atUtc:new Date(now).toISOString()};
 fs.writeFileSync(path.join(directory,'last-pull.json'),'\uFEFF'+JSON.stringify(status));
 return {id:kind,directory,kind,maxArchiveHours:kind==='native'?30:9};
}
test('both existing checksum conventions and Windows BOM are supported',async t=>{
 for(const kind of ['native','platform']){const r=await inspectBackup(fixture(t,kind),now);assert.equal(r.verified,true);assert.deepEqual(r.alarms,[]);}
});
test('successful recent pull does not refresh an old archive',async t=>{
 const r=await inspectBackup(fixture(t,'platform','20261009T040000Z.tar.gz'),now);
 assert.equal(r.verified,true);assert.deepEqual(r.alarms,['archive_stale']);
});
test('corrupt latest archive never falls back to an older valid one',async t=>{
 const config=fixture(t);fs.writeFileSync(path.join(config.directory,'20261010T050000Z.tar.gz'),'broken');
 const r=await inspectBackup(config,now);assert.equal(r.archive,'20261010T050000Z.tar.gz');assert.equal(r.verified,false);assert.deepEqual(r.alarms,['archive_integrity']);
});
test('stale pull, failed pull, future archive and absent archives are distinct',async t=>{
 const config=fixture(t,'native','20261011T040000Z.tar.gz');
 fs.writeFileSync(path.join(config.directory,'last-pull.json'),JSON.stringify({status:'failed',observedAt:'2026-10-09T00:00:00Z'}));
 assert.deepEqual((await inspectBackup(config,now)).alarms,['pull_failed','pull_stale','archive_future']);
 assert.deepEqual((await inspectBackup({...config,directory:path.join(config.directory,'missing')},now)).alarms,['pull_missing','archive_missing']);
});
test('mismatched checksum filename and modified bytes cannot attest success',async t=>{
 const config=fixture(t),name='20261010T040000Z.tar.gz';
 fs.appendFileSync(path.join(config.directory,name),'corrupt');
 assert.equal((await inspectBackup(config,now)).verified,false);
 fs.writeFileSync(path.join(config.directory,'20261010T040000Z.sha256'),'0'.repeat(64)+'  ../other');
 assert.equal((await inspectBackup(config,now)).verified,false);
 assert(Number.isNaN(archiveTime('20260230T000000Z.tar.gz')));
});
