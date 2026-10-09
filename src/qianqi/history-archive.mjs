import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {collectHistory} from './history-collector.mjs';
import {canonical,check,contentHash} from './ticket-shadow.mjs';

// No network fallback: incomplete historical evidence must stop the import.
export async function verifyHistoryArchive({history,capture,routes}) {
  const records=new Map(),cache=new Map();
  for(const file of (await readdir(history)).filter(f=>/^\d+-rpc\.json$/.test(f)).sort()){
    const r=JSON.parse(await readFile(resolve(history,file),'utf8'));
    records.set(canonical([r.method,r.params]),r.result);
  }
  const seed=(method,params,value)=>cache.set(canonical([method,params]),value);
  const rpc=async(method,params,fresh=false)=>{
    const key=canonical([method,params]);
    const value=(!fresh&&cache.has(key))?cache.get(key):records.get(key);
    check(value!==undefined,'Incomplete offline history evidence');
    return structuredClone(value);
  };
  const result=await collectHistory({capture,routes,rpc,seed});
  check(result.status==='HISTORY_SNAPSHOTS_MATCH','History archive mismatch');
  const {publicProfile,provenance,purchases,events,replay,datasets,counts}=result;
  const payload={schema:'qianqi-history-import-v1',executionEligible:false,publicProfile,provenance,purchases,events,replay,datasets,counts};
  return {payload,digest:contentHash(payload)};
}
