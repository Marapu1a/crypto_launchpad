import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {inProject,createPool,verifyRole} from '../../shared/store.mjs';
const require=createRequire(import.meta.url);
const native=require('./runtime/scripts/user-status-api.cjs');
const {hash}=require('./runtime/scripts/direct-buy.cjs');
const checksum=text=>createHash('sha256').update(text).digest('hex');
const maps=['balances','buys','decisions','rewards'];

export function projectSnapshot(config,raw){
 const view=native.prepare(config,raw);
 const publicConfig={manifest:Object.fromEntries(['chainId','token','anchor','entryThresholdRaw','quoteDecimals'].map(k=>[k,config.manifest[k]])),lifecycle:{vault:config.lifecycle.vault},indexer:{maxAgeSeconds:config.indexer.maxAgeSeconds}};
 const encoded={...view};for(const key of maps)encoded[key]=view[key]===null?null:[...view[key]];
 const text=JSON.stringify({schema:'qianqi-public-view-v1',config:publicConfig,view:encoded});
 return {text,hash:checksum(text),head:view.ledger.head,configHash:hash(config)};
}

export async function publishSnapshot(pool,projectId,config,raw){
 const projection=projectSnapshot(config,raw);
 await inProject(pool,projectId,async c=>{
  const {rows:[project]}=await c.query('SELECT chain_id::text,token_address FROM launchpad.projects WHERE id=$1',[projectId]);
  if(!project||project.chain_id!==String(config.manifest.chainId)||project.token_address.toLowerCase()!==config.manifest.token.toLowerCase())throw Error('Public view project mismatch');
  const result=await c.query(`UPDATE launchpad.qianqi_api_views SET head_number=$3,head_hash=$4,view_text=$5,view_hash=$6
   WHERE project_id=$1 AND config_hash=$2 AND (head_number IS NULL OR head_number<$3 OR (head_number=$3 AND head_hash=$4))`,
   [projectId,projection.configHash,projection.head.number,projection.head.hash,projection.text,projection.hash]);
  if(result.rowCount!==1)throw Error('Public view binding/branch refused');
 },{readOnly:false});
 return {head:projection.head,bytes:Buffer.byteLength(projection.text)};
}

export function createDatabaseReader(pool,projectId,configHash){
 let cached=null,lastHash=null;
 return {close(){cached=null;lastHash=null;},async read(query){
  try{
   const row=await inProject(pool,projectId,async c=>(await c.query('SELECT config_hash,view_text,view_hash FROM launchpad.qianqi_api_views WHERE project_id=$1',[projectId])).rows[0]);
   if(!row||row.config_hash!==configHash||!row.view_text||checksum(row.view_text)!==row.view_hash)throw Error('Invalid public view');
   if(lastHash!==row.view_hash){
    const value=JSON.parse(row.view_text);if(value.schema!=='qianqi-public-view-v1')throw Error('Invalid public view schema');
    for(const key of maps)value.view[key]=value.view[key]===null?null:new Map(value.view[key]);
    cached=value;lastHash=row.view_hash;
   }
   return structuredClone(native.render(cached.config,cached.view,query));
  }catch{cached=null;lastHash=null;return native.unavailable(query.wallet);}
 }};
}

// Invoked inside the index pass child, never in the shared API process.
export async function publishConfiguredSnapshot(config){
 const binding=JSON.parse(fs.readFileSync(process.env.SHARED_QIANQI_INDEXER_BINDING,'utf8'));
 if(binding.schema!=='qianqi-indexer-binding-v1'||binding.configHash!==hash(config))throw Error('Indexer binding mismatch');
 const pool=createPool(process.env.SHARED_JOBS_DATABASE_URL);
 try{await verifyRole(pool,'lp_jobs');return await publishSnapshot(pool,binding.projectId,config,fs.readFileSync(config.indexer.statePath,'utf8'));}
 finally{await pool.end();}
}
