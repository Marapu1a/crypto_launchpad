import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function archiveTime(name){
 const m=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.tar\.gz$/.exec(name);
 if(!m)return NaN;
 const iso=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`,time=Date.parse(iso);
 return Number.isFinite(time)&&new Date(time).toISOString()===iso.replace('Z','.000Z')?time:NaN;
}

// Read-only: never repair, prune or overwrite archives, checksum files or pull status.
export async function inspectBackup({id,directory,kind,maxArchiveHours,maxPullHours=3},now=Date.now()){
 const result={id,alarms:[],archive:null,verified:false};
 const alarm=code=>result.alarms.push(code);
 if(!['native','platform'].includes(kind)||!Number.isFinite(maxArchiveHours)||maxArchiveHours<=0||!Number.isFinite(maxPullHours)||maxPullHours<=0)throw Error('Invalid backup policy');
 try{
  const pull=JSON.parse(fs.readFileSync(path.join(directory,'last-pull.json'),'utf8').replace(/^\uFEFF/,''));
  const at=Date.parse(kind==='native'?pull.observedAt:pull.atUtc);
  if(String(pull.status).toLowerCase()!=='verified')alarm('pull_failed');
  if(!Number.isFinite(at)||at>now+300000||now-at>maxPullHours*3600000)alarm('pull_stale');
 }catch{alarm('pull_missing');}
 let names;
 try{names=fs.readdirSync(directory).filter(n=>Number.isFinite(archiveTime(n))).sort();}
 catch{alarm('archive_missing');return result;}
 if(!names.length){alarm('archive_missing');return result;}
 const name=names.at(-1),at=archiveTime(name);result.archive=name;
 result.archiveAt=new Date(at).toISOString();
 if(at>now+300000)alarm('archive_future');
 if(now-at>maxArchiveHours*3600000)alarm('archive_stale');
 try{
  const checksumFile=kind==='native'?name.replace(/\.tar\.gz$/,'.sha256'):name+'.sha256';
  const checksum=fs.readFileSync(path.join(directory,checksumFile),'utf8').trim();
  const match=/^([a-fA-F0-9]{64})\s+\*?([^\r\n]+)$/.exec(checksum);
  if(!match||match[2]!==name)throw Error('checksum');
  const file=path.join(directory,name),before=fs.statSync(file),hash=createHash('sha256');
  if(!before.isFile()||before.size===0)throw Error('archive');
  for await(const bytes of fs.createReadStream(file))hash.update(bytes);
  const after=fs.statSync(file);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('changed');
  const digest=hash.digest('hex');
  if(digest!==match[1].toLowerCase())throw Error('mismatch');
  result.verified=true;result.sha256=digest;result.bytes=after.size;
 }catch{alarm('archive_integrity');}
 return result;
}
