import { createServer } from 'node:http';
import { createPool,verifyRole } from './store.mjs';
import { sharedApi } from './api.mjs';

if(!process.env.SHARED_DATABASE_URL)throw Error('SHARED_DATABASE_URL is required (lp_api role)');
const pool=createPool(process.env.SHARED_DATABASE_URL);
try{await verifyRole(pool,'lp_api');}catch{await pool.end();throw Error('Shared database role/connection check failed');}
const server=createServer(sharedApi(pool));
server.listen(Number(process.env.SHARED_PORT||4180),'127.0.0.1',()=>console.log('Shared read-only API listening on loopback'));
const stop=()=>server.close(()=>pool.end());
process.once('SIGINT',stop);process.once('SIGTERM',stop);
