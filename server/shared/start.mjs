import { createServer } from 'node:http';
import { createPool,verifyRole } from './store.mjs';
import { sharedApi } from './api.mjs';
import {projectSite} from './site.mjs';
import fs from 'node:fs';
import { loadQianqiApiAdapters } from '../adapters/qianqi/api.mjs';

if(!process.env.SHARED_DATABASE_URL)throw Error('SHARED_DATABASE_URL is required (lp_api role)');
const pool=createPool(process.env.SHARED_DATABASE_URL);
try{await verifyRole(pool,'lp_api');}catch{await pool.end();throw Error('Shared database role/connection check failed');}
let projectAdapters;
try{projectAdapters=process.env.SHARED_QIANQI_API_REGISTRY?await loadQianqiApiAdapters(pool,JSON.parse(fs.readFileSync(process.env.SHARED_QIANQI_API_REGISTRY,'utf8'))):new Map();}
catch{await pool.end();throw Error('Shared API adapter configuration check failed');}
const server=createServer(process.env.SHARED_PROJECT_SITE==='1'?projectSite(pool,{projectAdapters}):sharedApi(pool,{projectAdapters}));
server.listen(Number(process.env.SHARED_PORT||4180),'127.0.0.1',()=>console.log('Shared read-only API listening on loopback'));
const stop=()=>server.close(()=>{for(const adapter of projectAdapters.values())adapter.close();void pool.end();});
process.once('SIGINT',stop);process.once('SIGTERM',stop);
