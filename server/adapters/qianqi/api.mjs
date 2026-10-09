import { createRequire } from 'node:module';
import { inProject } from '../../shared/store.mjs';
import { createDatabaseReader } from './read-model.mjs';
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
   const row=await inProject(pool,entry.projectId,async c=>(await c.query('SELECT config_hash FROM launchpad.qianqi_api_views WHERE project_id=$1',[entry.projectId])).rows[0]);
   if(!row||row.config_hash!==entry.configHash)throw Error('Invalid pinned API configuration');
   adapters.set(entry.projectId,handlerFactory(null,{reader:createDatabaseReader(pool,entry.projectId,entry.configHash)}));
  }
  return adapters;
 }catch(error){for(const adapter of adapters.values())adapter.close();throw error;}
}
