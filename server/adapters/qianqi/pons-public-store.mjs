import {openSync,writeFileSync,fsyncSync,closeSync,renameSync,readFileSync,statSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {digest} from '../../../src/tickets/digest.mjs';
import {renderPonsPublic} from './pons-projection.mjs';
const require=createRequire(import.meta.url),{unavailable}=require('./runtime/scripts/user-status-api.cjs');
// Dedicated public file, never the scheduler journal. Failed production preserves the last good snapshot.
export function savePonsPublic(file,snapshot){
 const temp=file+'.'+randomUUID()+'.tmp';let fd;
 try{fd=openSync(temp,'wx');writeFileSync(fd,JSON.stringify({snapshot,checksum:digest(snapshot)}));fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,file);}
 finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
const generation=s=>[s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
export function createPonsPublicReader({config,file,now=Date.now,maxAgeSeconds=660}){
 config=structuredClone(config);let cached,key;
 return {close(){cached=null;key=null;},read(query={}){
  try{
   const current=generation(statSync(file,{bigint:true}));
   if(current!==key){
    const document=JSON.parse(readFileSync(file,'utf8'));
    if(document.checksum!==digest(document.snapshot)||current!==generation(statSync(file,{bigint:true})))throw Error('Public snapshot changed');
    cached=document.snapshot;key=current;
   }
   return renderPonsPublic(config,cached,{...query,now:now(),maxAgeSeconds});
  }catch{cached=null;key=null;return unavailable(query.wallet);}
 }};
}
