import {mkdir,open,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export async function replaceHealthFile(from,to,{replace=rename,platform=process.platform,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 for(let attempt=0;;attempt++){
  try{await replace(from,to);return;}
  catch(e){if(platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=5)throw e;await pause(20*(attempt+1));}
 }
}
export async function writeHealthFile(file,report){
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 const tmp=file+'.'+randomUUID()+'.tmp',f=await open(tmp,'wx',0o600);
 try{await f.writeFile(JSON.stringify(report));await f.sync();}finally{await f.close();}
 await replaceHealthFile(tmp,file);
}
