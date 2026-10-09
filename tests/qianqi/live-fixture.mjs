import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {canonical} from '../../src/qianqi/ticket-shadow.mjs';
export const liveDirectory=resolve('.local/test-results/qianqi-live-2026-10-09T15-59-42-447Z');
export const previous=JSON.parse(readFileSync(resolve(liveDirectory,'previous.json'))),liveReport=JSON.parse(readFileSync(resolve(liveDirectory,'report.json')));
export function capturedReads(edit=()=>{}){
 const rpcRows=new Map(),apiRows=new Map();
 for(const f of readdirSync(liveDirectory).filter(f=>/^\d+-(rpc|api).json$/.test(f))){const r=JSON.parse(readFileSync(resolve(liveDirectory,f)));(r.method?rpcRows:apiRows).set(r.method?canonical([r.method,r.params]):r.path,r);}
 return {rpc:async(method,params)=>{const row=rpcRows.get(canonical([method,params]));if(!row)throw Error('Missing live captured RPC '+method);const copy=structuredClone(row);edit(copy);return copy.result;},getJson:async path=>{const row=apiRows.get(path);if(!row)throw Error('Missing live captured API');const copy=structuredClone(row);edit(copy);return copy.data;}};
}
