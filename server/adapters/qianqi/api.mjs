import { createRequire } from 'node:module';
import { inProject } from '../../shared/store.mjs';
import { createDatabaseReader } from './read-model.mjs';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {digest} from '../../../src/tickets/digest.mjs';
import {createPonsPublicReader} from './pons-public-store.mjs';
const require=createRequire(import.meta.url);
const {createHandler}=require('./runtime/scripts/user-status-api.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Server-owned registry; request paths, Host headers and query parameters cannot add adapters.
export async function loadQianqiApiAdapters(pool,registry,{handlerFactory=createHandler}={}){
 if(registry?.schema!=='qianqi-api-registry-v1'||!Array.isArray(registry.projects))throw Error('Invalid QIANQI API registry');
 const adapters=new Map();
 try{
  for(const entry of registry.projects){
   if(!uuid.test(entry.projectId)||adapters.has(entry.projectId)||!/^0x[0-9a-f]{64}$/.test(entry.configHash??''))throw Error('Invalid or duplicate API project');
   const row=await inProject(pool,entry.projectId,async c=>(await c.query('SELECT v.config_hash,p.token_address,p.chain_id::text FROM launchpad.qianqi_api_views v JOIN launchpad.projects p ON p.id=v.project_id WHERE v.project_id=$1',[entry.projectId])).rows[0]);
   if(!row||row.config_hash!==entry.configHash)throw Error('Invalid pinned API configuration');
   let reader;
   if(entry.source==='pons-api-v1'){
    if(!isAbsolute(entry.ponsConfigFile??'')||!isAbsolute(entry.publicFile??''))throw Error('Absolute Pons API paths required');
    const document=JSON.parse(await readFile(entry.ponsConfigFile,'utf8')),config=document.scheduler??document;
    if(entry.ponsConfigHash!==digest({manifest:config.manifest,lifecycle:config.lifecycle})||row.chain_id!=='4663'||row.token_address.toLowerCase()!==config.manifest.token.toLowerCase())throw Error('Pons API project binding mismatch');
    reader=createPonsPublicReader({config,file:entry.publicFile});
   }else{if(entry.source!==undefined)throw Error('Unknown QIANQI API source');reader=createDatabaseReader(pool,entry.projectId,entry.configHash);}
   adapters.set(entry.projectId,handlerFactory(null,{reader}));
  }
  return adapters;
 }catch(error){for(const adapter of adapters.values())adapter.close();throw error;}
}
