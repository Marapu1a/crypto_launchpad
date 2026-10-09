import {mkdirSync,readdirSync,lstatSync,readFileSync,writeFileSync,renameSync,statfsSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,isAbsolute,dirname,parse} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';

export class ShadowStop extends Error {
 constructor(reason){super(reason);this.code='SHADOW_STOP';}
}
const stop=message=>{throw new ShadowStop(message);};
const positive=(value,name)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)stop('Invalid '+name);return n;};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function shadowConfig(env=process.env){
 const root=env.QIANQI_STATE_DIR;
 if(!root||!isAbsolute(root)||resolve(root)===parse(root).root)stop('Absolute dedicated QIANQI_STATE_DIR required');
 if(!uuid.test(env.SHARED_PROJECT_ID??'')||!uuid.test(env.SHARED_MODULE_ID??''))stop('Invalid shadow identity');
 return {root:resolve(root),project:env.SHARED_PROJECT_ID.toLowerCase(),module:env.SHARED_MODULE_ID.toLowerCase(),
  maxBytes:positive(env.QIANQI_MAX_BYTES??3*1024**3,'storage budget'),
  minFreeBytes:positive(env.QIANQI_MIN_FREE_BYTES??10*1024**3,'free disk floor'),
  cycleBytes:positive(env.QIANQI_CYCLE_BYTES??16*1024**2,'cycle budget'),
  durationMs:positive(env.QIANQI_DURATION_SECONDS??86400,'duration')*1000,
  intervalMs:positive(env.QIANQI_INTERVAL_SECONDS??60,'interval')*1000};
}
function safePath(path){
 for(let current=resolve(path);;current=dirname(current)){
  if(existsSync(current)&&lstatSync(current).isSymbolicLink())stop('Symlink in shadow storage');
  if(dirname(current)===current)break;
 }
}
export function treeBytes(root){
 let total=0;
 for(const name of readdirSync(root)){
  const path=join(root,name),s=lstatSync(path);
  if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))stop('Unsupported entry in shadow storage');
  total+=s.isDirectory()?treeBytes(path):s.size;
 }return total;
}
const sha=text=>createHash('sha256').update(text).digest('hex');
// No automatic deletion: evidence remains replayable until the bounded run stops.
export function openShadowStorage(config,{now=Date.now,freeBytes=()=>{const s=statfsSync(config.root);return s.bavail*s.bsize;}}={}){
 safePath(config.root);mkdirSync(config.root,{recursive:true,mode:0o700});
 if(realpathSync(config.root)!==resolve(config.root))stop('Noncanonical shadow storage');
 const marker=join(config.root,'rehearsal.json');
 if(!existsSync(marker)){
  if(readdirSync(config.root).length)stop('Shadow storage must be new or initialized');
  const startedAt=now();writeFileSync(marker,JSON.stringify({schema:1,config,startedAt,deadline:startedAt+config.durationMs}),{flag:'wx',mode:0o600});
 }
 const run=JSON.parse(readFileSync(marker,'utf8'));
 if(run.schema!==1||JSON.stringify(run.config)!==JSON.stringify(config)||!Number.isSafeInteger(run.deadline)||run.deadline!==run.startedAt+config.durationMs)stop('Shadow storage binding mismatch');
 for(const name of ['objects','cycles']){safePath(join(config.root,name));mkdirSync(join(config.root,name),{recursive:true,mode:0o700});}
 let bytes=treeBytes(config.root),databaseBytes=0,cycleSize=0,refs=[],cycle=null;
 function check(extra=0){
  if(now()>=run.deadline)stop('Rehearsal deadline reached');
  if(bytes+databaseBytes+extra>config.maxBytes)stop('Shadow storage budget reached');
  if(freeBytes()-extra<config.minFreeBytes)stop('Shadow free disk floor reached');
 }
 function write(path,data,{replace=false}={}){
  const size=Buffer.byteLength(data);check(size);
  if(cycleSize+size>config.cycleBytes)stop('Shadow cycle storage budget reached');
  safePath(path);
  const old=replace&&existsSync(path)?lstatSync(path).size:0;
  if(replace){const tmp=path+'.'+randomUUID()+'.tmp';writeFileSync(tmp,data,{flag:'wx',mode:0o600});renameSync(tmp,path);}
  else writeFileSync(path,data,{flag:'wx',mode:0o600});
  bytes+=size-old;cycleSize+=size;
 }
 return {
  begin(dbBytes){
   databaseBytes=Number(dbBytes);if(!Number.isSafeInteger(databaseBytes)||databaseBytes<0)stop('Invalid database size');
   bytes=treeBytes(config.root);cycleSize=0;refs=[];cycle=randomUUID();check(config.cycleBytes);
  },
  save(kind,row){
   if(!cycle||!['rpc','api'].includes(kind))stop('Invalid shadow capture');
   const data=JSON.stringify({kind,row}),digest=sha(data),file=join(config.root,'objects',digest+'.json.gz');
   check();
   if(existsSync(file)){
    safePath(file);let original;
    try{original=gunzipSync(readFileSync(file));}catch{stop('Shadow evidence checksum mismatch');}
    if(sha(original)!==digest)stop('Shadow evidence checksum mismatch');
   }
   else write(file,gzipSync(data));
   refs.push(digest);if(refs.length>10000)stop('Shadow capture count exceeded');
  },
  finish(report){
   if(!cycle)stop('Missing shadow cycle');
   write(join(config.root,'cycles',cycle+'.json'),JSON.stringify({schema:1,at:now(),refs,report}));
   write(join(config.root,'latest.json'),JSON.stringify({...report,at:now(),deadline:run.deadline,bytes,databaseBytes}),{replace:true});
   cycle=null;
  },
  databaseSize(value){databaseBytes=Number(value);if(!Number.isSafeInteger(databaseBytes)||databaseBytes<0)stop('Invalid database size');check();},
  check,deadline:run.deadline,
 };
}
export function readCapturedCycle(root,id){
 if(!/^[0-9a-f-]{36}$/.test(id))stop('Invalid cycle id');
 const manifest=JSON.parse(readFileSync(join(root,'cycles',id+'.json'),'utf8'));
 const records=manifest.refs.map(digest=>{
  if(!/^[a-f0-9]{64}$/.test(digest))stop('Invalid evidence digest');
  const data=gunzipSync(readFileSync(join(root,'objects',digest+'.json.gz')));
  if(sha(data)!==digest)stop('Shadow evidence checksum mismatch');return JSON.parse(data);
 });return {report:manifest.report,records};
}
