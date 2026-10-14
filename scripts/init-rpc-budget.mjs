import {resolve} from 'node:path';
import budget from '../server/shared/rpc-budget.cjs';
const [file,max,window,...extra]=process.argv.slice(2);
if(!file||!max||!window||extra.length)throw Error('Usage: node scripts/init-rpc-budget.mjs FILE MAX_REQUESTS WINDOW_MS');
await budget.initializeBudget(resolve(file),{maxRequests:Number(max),windowMs:Number(window)});
console.log('RPC budget initialized; existing files are never overwritten.');
