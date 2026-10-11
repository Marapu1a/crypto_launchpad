// Operator preparation only. Generates new encrypted role keys, never sends funds.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {JsonRpcProvider,FetchRequest,getAddress} from 'ethers';
import rpcConfig from './rpc-config.cjs';
import pins from '../config/pons-production-pins.json' with {type:'json'};
import {createExecutorKeystore} from '../src/worker/executor-keystore.mjs';
import {validateProductionProfile,verifyProductionEnvironment} from '../server/owner-launch/production-profile.mjs';
import {readTerms} from '../src/pons/client.mjs';
import {USDG} from '../src/launch/template.mjs';
import {fetchInfo,fetchLatest} from '../src/randomness/drand.mjs';
import {assessTiming} from '../src/worker/production-timing.mjs';
import {privateText} from '../server/short-runtime/config.mjs';
import {initialDraft} from '../src/pons/plan.mjs';
import {upgradeProgramDraft} from '../src/draws/program-config.mjs';
import preset from '../config/rehearsals/first-token.json' with {type:'json'};
import {digest} from '../src/tickets/digest.mjs';

const root=path.resolve(process.argv[3]??('.local/production-preparation/'+new Date().toISOString().replace(/[:.]/g,'-')));
await fs.mkdir(path.dirname(root),{recursive:true,mode:0o700});
await fs.mkdir(root,{mode:0o700});
if(process.platform==='win32'){const account=execFileSync('whoami',[],{encoding:'utf8',windowsHide:true}).trim();execFileSync('icacls',[root,'/inheritance:r','/grant:r',account+':(OI)(CI)F'],{stdio:'ignore',windowsHide:true});}
const report={at:new Date().toISOString(),authorizationToSend:false,status:'INCOMPLETE'};
let provider,phase='request';
const write=(file,value)=>fs.writeFile(path.join(root,file),JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n',{flag:'wx',mode:0o600});
try{
 const request=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 if(request.schema!=='owner-production-request-v2'||!request.timing||!request.limits||!request.funding||!request.totalNativeLimit)throw Error();
 const id=randomUUID(),owner=getAddress(request.owner);
 phase='public-observation';
 const rpcFile=path.resolve(request.rpcFile??rpcConfig.LOCAL_RPC_FILE),rpc=new FetchRequest(await privateText(rpcFile)),source='explicit-file';rpc.timeout=15000;
 provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});
 const anchor=await provider.getBlock('finalized');if(!anchor)throw Error();
 // Addresses are newly generated for this package, never taken from a rehearsal.
 phase='new-role-keys';const keys={};
 for(const role of ['executor','publisher']){
  const password=randomBytes(32).toString('hex'),passwordFile=path.join(root,role+'.password');
  await fs.writeFile(passwordFile,password,{flag:'wx',mode:0o600});
  const key=await createExecutorKeystore({directory:path.join(root,role),projectId:id,password});keys[role]={keyFile:key.file,passwordFile,address:key.address};
 }
 const profile=validateProductionProfile({schema:'owner-production-profile-v2',mode:'production',id,chainId:4663,instanceId:'production:'+id,owner,executor:keys.executor.address,publisher:keys.publisher.address,
  anchor:{number:anchor.number,hash:anchor.hash},externals:pins.pins,timing:request.timing,limits:request.limits,funding:request.funding,totalNativeLimit:request.totalNativeLimit});
 phase='profile-preflight';const observation=await verifyProductionEnvironment(provider,profile);
 const terms=await readTerms(provider,{account:owner,pair:USDG,configId:0});
 if(!terms.enabled||!terms.canLaunch)throw Error();
 await fetchInfo();const timing=assessTiming({observation,timing:profile.timing,beacon:await fetchLatest()});
 if(timing.status!=='observed')throw Error();
 await write('profile.json',profile);await write('keys.json',keys);
 // Credential references are intentional placeholders until the durable DB is connected.
 const config={schema:'owner-production-v2',profile,allowPublicTransactions:false,httpPort:4190,rpcFile,
  databaseFiles:{admin:path.join(root,'admin-database-url'),executor:path.join(root,'executor-database-url'),api:path.join(root,'api-database-url')},
  keys,baseDomain:request.baseDomain??'tokens.localhost',healthFile:path.join(root,'draw-health.json'),defaults:request.defaults??{draft:{...initialDraft(),pair:USDG,creatorFee:preset.creatorFee,openingBuy:'0'},draws:upgradeProgramDraft(preset.draws,10000),team:'',operations:''}};
 await write('owner-server.disabled.json',config);
 report.status='PREPARED_DISABLED';report.profileHash=digest(profile);report.owner=owner;report.roleAddresses={executor:profile.executor,publisher:profile.publisher};
 report.observation=observation;report.terms=terms;report.timing=timing;report.rpcSource=source;
 report.remaining=['Review owner draft, explicit budgets and timing','Configure durable PostgreSQL credential files and actual domain','Install disabled service, notifications and backup/restore','Owner approval before any public signing'];
 console.log('Prepared without transactions: '+root);
}catch{report.phase=phase;report.status='INCOMPLETE';console.error('Preparation incomplete at '+phase+'; private material retained, never retry by overwriting it.');process.exitCode=1;}
finally{await write('report.json',report);provider?.destroy();}
