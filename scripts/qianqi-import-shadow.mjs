import {readFileSync} from 'node:fs';
import {resolve,dirname,isAbsolute} from 'node:path';
import {createPool} from '../server/shared/store.mjs';
import {importQianqiHistory} from '../server/shared/qianqi-history.mjs';
// Imports only into an already provisioned, explicitly bound shadow project/module.
let pool;
try{
 const file=process.env.QIANQI_ARCHIVE_MANIFEST;
 if(!file||!isAbsolute(file)||!process.env.SHARED_JOBS_URL||!process.env.SHARED_PROJECT_ID||!process.env.SHARED_MODULE_ID)throw Error();
 const manifest=JSON.parse(readFileSync(file,'utf8'));
 const archive=Object.fromEntries(['history','capture','routes'].map(k=>{
  if(typeof manifest[k]!=='string'||!manifest[k])throw Error();return [k,resolve(dirname(file),manifest[k])];
 }));
 pool=createPool(process.env.SHARED_JOBS_URL);
 const result=await importQianqiHistory(pool,process.env.SHARED_PROJECT_ID,process.env.SHARED_MODULE_ID,archive);
 console.log(JSON.stringify({status:'VERIFIED_IMPORT',head:result.payload.provenance.head,digest:result.digest,inserted:result.inserted,executionEligible:false}));
}catch{console.error('Shadow import failed; verify archive manifest, evidence and project binding');process.exitCode=1;}
finally{await pool?.end();}
