import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createTestPostgres} from '../contracts/production-postgres.mjs';
import {createHolderProgram} from '../../src/holders/program.mjs';
import {collectHolderSnapshot} from '../../src/holders/snapshot.mjs';
import {identity} from '../../src/holders/values.mjs';
import {registerHolderPreparation,appendHolderPreparation,readHolderPreparation} from '../../server/shared/holder-preparation.mjs';
const root='.local/test-results/holder-benchmark-'+new Date().toISOString().replace(/[:.]/g,'-');await mkdir(root,{recursive:true});
const rows=[],address=n=>'0x'+n.toString(16).padStart(40,'0');let db;
try{
 db=await createTestPostgres(root+'/postgres');
 for(const [caseId,count,months] of [[1,500,1],[2,500,12],[3,5000,1],[4,5000,12],[5,20000,1]]){
  const scope={projectId:`00000000-0000-4000-8000-${String(caseId).padStart(12,'0')}`,chainId:4663,token:address(100000+caseId),asset:address(0)};
  await db.admin.query("INSERT INTO launchpad.projects VALUES($1,$2,'Benchmark',4663,$3,'test')",[scope.projectId,'benchmark-'+caseId,scope.token]);
  await registerHolderPreparation(db.pools.jobs,createHolderProgram({scope,launchAt:100,minimumPayment:'1',exclusions:[],preset:'pw-v1-60-20-20'}));
  const holders=Array.from({length:count},(_,i)=>({wallet:address(i+1),balance:'1'}));let last,appendMs=0;
  const before=process.memoryUsage().heapUsed;
  for(let month=1;month<=months;month++){
   const candidate=await collectHolderSnapshot({chainId:4663,token:scope.token,observedAt:100+month*2592000,maxPages:1000,maxHolders:count,fetchPage:async cursor=>{
    const offset=Number(cursor??0);return {token:scope.token,holders:count,supply:String(count),as_of:{rollup_bucket:month,tail_from_block:month},page:holders.slice(offset,offset+50),next_cursor:offset+50<count?String(offset+50):null};
   }});
   last={id:'snapshot-'+month,scopeId:identity(scope),type:'snapshot.observed',candidate};
   const start=performance.now();await appendHolderPreparation(db.pools.jobs,scope,last);appendMs=performance.now()-start;
  }
  let start=performance.now();await appendHolderPreparation(db.pools.jobs,scope,last);const duplicateMs=performance.now()-start;
  start=performance.now();await readHolderPreparation(db.pools.api,scope,{now:100+months*2592000,candidateId:last.candidate.id});const previewMs=performance.now()-start;
  const {rows:[size]}=await db.admin.query('SELECT octet_length(body::text) AS bytes FROM launchpad.holder_preparations WHERE project_id=$1',[scope.projectId]);
  const row={holders:count,snapshots:months,jsonBytes:size.bytes,lastAppendMs:Math.round(appendMs),duplicateMs:Math.round(duplicateMs),previewMs:Math.round(previewMs),heapDeltaBytes:process.memoryUsage().heapUsed-before};rows.push(row);console.log(JSON.stringify(row));
 }
}finally{await writeFile(root+'/report.json',JSON.stringify({rows,limits:['Synthetic local PostgreSQL, single sample per case, not a throughput/peak-memory guarantee','Append wall time includes validation, serialization, network and lock duration; not a standalone lock measurement','Heap delta affected by garbage collection; not peak heap']},null,2));await db?.close();console.log(root+'/report.json');}
