const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {withState,inspectLock}=require('../scripts/local-scheduler-state.cjs');
const execFile=require('node:util').promisify(require('node:child_process').execFile);
function location(t){fs.mkdirSync('.local',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.local','lock-unit-'));
 t.after(()=>{for(const n of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,n));fs.rmdirSync(dir);});return path.join(dir,'state.json');}

test('indexer format migrates legacy atomically, detects corruption and does not alter money journals',async t=>{
 const file=location(t),config={kind:'persistent-buy-indexer-v1'},options={indexerFormat:true};
 await withState(file,config,async(s,save)=>{s.marker='before';save(s);});
 assert.match(JSON.parse(fs.readFileSync(file)).checksum,/^0x[0-9a-f]{64}$/);
 await withState(file,config,async(s,save)=>{assert.equal(s.marker,'before');save(s);},options);
 const before=fs.readFileSync(file,'utf8');assert.match(JSON.parse(before).checksum,/^sha256-v1:/);
 const rename=fs.renameSync;fs.renameSync=(src,dst)=>{if(dst===file)throw Object.assign(Error('disk failure'),{code:'EIO'});return rename(src,dst);};
 try{await assert.rejects(withState(file,config,async(s,save)=>{s.marker='after';save(s);},options),e=>e.code==='SCHEDULER_STORAGE_ERROR');}finally{fs.renameSync=rename;}
 assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(inspectLock(file+'.lock').exists,false);
 await withState(file,config,async(s)=>assert.equal(s.marker,'before'),options);
 await assert.rejects(withState(file,{},async()=>{},options),/restricted/);
 await assert.rejects(withState(file,config,async()=>{}),/checksum\/config/);
 fs.writeFileSync(file,before.replace('before','broken'));
 await assert.rejects(withState(file,config,async()=>assert.fail('corrupt snapshot accepted'),options),/checksum\/config/);
});
test('async state save resolves without lock and permits child process handoff repeatedly',async t=>{
 const file=location(t),child=`const {withState}=require('./scripts/local-scheduler-state.cjs');withState(process.argv[1],{},async(s,save)=>{await new Promise(r=>setTimeout(r,1));save(s)}).catch(e=>{console.error(e);process.exitCode=1});`;
 for(let i=0;i<5;i++){
  await withState(file,{},async(s,save)=>{await new Promise(r=>setTimeout(r,1));save(s);});
  assert.equal(inspectLock(file+'.lock').exists,false);
  const result=await execFile(process.execPath,['-e',child,file]);
  if(process.env.LOCAL_STATE_LOCK_TRACE==='1')process.stderr.write(result.stderr);
  assert.equal(inspectLock(file+'.lock').exists,false);
 }
});
test('occupied lock reports bounded metadata without deleting another owner',async t=>{
 const file=location(t);fs.writeFileSync(file+'.lock','987654');
 await assert.rejects(()=>withState(file,{},async()=>assert.fail('must not enter')),e=>{
  assert.equal(e.lock.owner,'987654');assert.equal(e.lock.exists,true);assert.equal(typeof e.lock.mtimeMs,'number');return /locked/.test(e.message);
 });assert.equal(fs.readFileSync(file+'.lock','utf8'),'987654');
});
test('action rejection releases lock before caller observes failure',async t=>{
 const file=location(t);await assert.rejects(()=>withState(file,{},async()=>{await Promise.resolve();throw Error('action failure');}),/action failure/);
 assert.equal(inspectLock(file+'.lock').exists,false);
});
for(const operation of ['writeFileSync','closeSync'])test('PID initialization '+operation+' failure releases owned fd and lock before rejection',async t=>{
 const file=location(t),original=fs[operation];let captured,failed=false,entered=false;
 fs[operation]=function(target,...args){
  if(typeof target==='number'&&!failed){failed=true;captured=target;throw Object.assign(Error('injected PID '+operation),{code:'EIO'});}
  return original.call(this,target,...args);
 };
 try{await assert.rejects(()=>withState(file,{},async()=>{entered=true;}),e=>e.code==='EIO');}
 finally{fs[operation]=original;}
 assert(failed);assert.equal(entered,false);assert.equal(inspectLock(file+'.lock').exists,false);
 assert.throws(()=>fs.fstatSync(captured),e=>e.code==='EBADF');
 await withState(file,{},async()=>{});
});
test('primary PID write and cleanup close failures both survive; unlink is still attempted',async t=>{
 const file=location(t),write=fs.writeFileSync,close=fs.closeSync;let fd;
 const primary=Object.assign(Error('primary write'),{code:'EPRIMARY'}),cleanup=Object.assign(Error('cleanup close'),{code:'ECLEANUP'});
 fs.writeFileSync=(target,...args)=>{if(typeof target==='number'){fd=target;throw primary;}return write(target,...args);};
 fs.closeSync=target=>{if(target===fd)throw cleanup;return close(target);};
 try{await assert.rejects(()=>withState(file,{},async()=>assert.fail('action started')),e=>{
  assert(e instanceof AggregateError);assert.equal(e.cause,primary);assert.equal(e.code,'EPRIMARY');assert.deepEqual(e.errors,[primary,cleanup]);return true;
 });}finally{fs.writeFileSync=write;fs.closeSync=close;if(fd!==undefined)close(fd);}
 assert.equal(inspectLock(file+'.lock').exists,false);
});
test('release error preserves primary transaction classification and does not claim cleanup succeeded',async t=>{
 const file=location(t),unlink=fs.unlinkSync,primary=Object.assign(Error('original send'),{code:'NETWORK_ERROR',stage:'broadcast',transactionHash:'0x123',definiteRejection:false});
 fs.unlinkSync=p=>{if(p===file+'.lock')throw Object.assign(Error('release failed'),{code:'EIO'});return unlink(p);};
 try{await assert.rejects(()=>withState(file,{},async()=>{throw primary;}),e=>{
  assert.equal(e.cause,primary);assert.equal(e.stage,'broadcast');assert.equal(e.transactionHash,'0x123');assert.equal(e.definiteRejection,false);assert.equal(e.cleanupErrors[0].code,'EIO');return true;
 });}finally{fs.unlinkSync=unlink;}
 assert.equal(inspectLock(file+'.lock').exists,true);
});

test('migration admission holds lock and rejected guard leaves bytes and history unchanged',async t=>{
 const file=location(t),old={version:1},next={version:2};
 await withState(file,old,(s,save)=>{s.nativeRefillHistory={spent:'7',lastAttemptAt:'10',lastNonce:'3'};save(s);});
 const before=fs.readFileSync(file,'utf8');let entered=false;
 await assert.rejects(()=>withState(file,next,()=>{entered=true;},{legacyConfigs:[old],validateMigration:async copy=>{
  assert.equal(inspectLock(file+'.lock').exists,true);copy.nativeRefillHistory.spent='0';
  await assert.rejects(()=>withState(file,old,()=>{}),/locked/);throw Error('incompatible');
 }}),/incompatible/);
 assert.equal(entered,false);assert.equal(fs.readFileSync(file,'utf8'),before);assert(!fs.existsSync(file+'.tmp'));
 await withState(file,next,s=>assert.deepEqual(s.nativeRefillHistory,{spent:'7',lastAttemptAt:'10',lastNonce:'3'}),{legacyConfigs:[old],validateMigration:s=>assert.equal(s.nativeRefillHistory.spent,'7')});
 assert.notEqual(fs.readFileSync(file,'utf8'),before);
});
test('pending forbids migration before admission callback and persistence',async t=>{
 const file=location(t);await withState(file,{v:1},(s,save)=>{s.pending={worker:'draw'};save(s);});
 const before=fs.readFileSync(file,'utf8');let called=false;
 await assert.rejects(()=>withState(file,{v:2},()=>{},{legacyConfigs:[{v:1}],validateMigration:()=>{called=true;}}),/Resolve pending/);
 assert(!called);assert.equal(fs.readFileSync(file,'utf8'),before);
});
test('low disk refuses index publication and retains the last snapshot',async t=>{
 const file=location(t),config={kind:'persistent-buy-indexer-v1'},options={indexerFormat:true};
 await withState(file,config,async(s,save)=>{s.marker='safe';save(s);},options);
 const before=fs.readFileSync(file),original=fs.statfsSync;
 fs.statfsSync=()=>({bavail:1,bsize:4096});
 try{await assert.rejects(withState(file,config,async(s,save)=>{s.marker='new';save(s);},options),e=>e.code==='SCHEDULER_STORAGE_ERROR');}finally{fs.statfsSync=original;}
 assert.deepEqual(fs.readFileSync(file),before);assert.equal(inspectLock(file+'.lock').exists,false);
});
test('oversize index snapshot stops before parsing and preserves evidence',async t=>{
 const file=location(t);fs.writeFileSync(file,'retained');const stat=fs.statSync;
 fs.statSync=function(p,...args){if(path.resolve(p)===file)return {size:384*1024**2};return stat.call(fs,p,...args);};
 try{await assert.rejects(withState(file,{kind:'persistent-buy-indexer-v1'},async()=>assert.fail(),{indexerFormat:true}),e=>e.code==='SCHEDULER_STORAGE_ERROR');}finally{fs.statSync=stat;}
 assert.equal(fs.readFileSync(file,'utf8'),'retained');assert.equal(inspectLock(file+'.lock').exists,false);
});
