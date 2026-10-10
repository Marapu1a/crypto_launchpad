import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {providerFor} from '../src/pons/client.mjs';
import {assertLocalFork} from '../src/pons/local-execution.mjs';
import {createPool} from '../server/shared/store.mjs';
import {testSigner} from '../server/studio/environment.mjs';
import {createStudio} from '../server/studio/service.mjs';
import {studioHttp} from '../server/studio/http.mjs';
const c=JSON.parse(fs.readFileSync(process.argv[2]));
for(const value of [c.rpcUrl,...Object.values(c.urls)])if(new URL(value).hostname!=='127.0.0.1')throw Error('Local endpoints only');
const provider=providerFor(c.rpcUrl);provider.pollingInterval=100;await assertLocalFork(provider);
const pools=Object.fromEntries(Object.entries(c.urls).map(([k,v])=>[k,createPool(v)]));
const signer=testSigner(provider),studio=createStudio({root:c.root,provider,signer,pools});
const defaults={config:JSON.parse(fs.readFileSync('config/rehearsals/first-token.json')),team:await (await provider.getSigner(2)).getAddress(),operations:await (await provider.getSigner(3)).getAddress()};
const server=createServer(studioHttp({studio,apiPool:pools.api,dist:path.resolve('dist'),defaults}));
server.requestTimeout=30000;server.headersTimeout=15000;
server.listen(c.httpPort,'127.0.0.1',()=>console.log('Launch studio: http://127.0.0.1:'+c.httpPort+'/launch.html'));
let active=false;
const timer=setInterval(async()=>{
 if(fs.existsSync(path.join(path.dirname(c.root),'stop-request'))){await stop();return;}
 if(active)return;active=true;
 try{
  const projects=studio.list().filter(p=>p.stage==='ready');
  if(projects.some(p=>p.rehearsalStarted)){
   const tip=await provider.getBlock('latest'),now=Math.floor(Date.now()/1000);
   if(tip.timestamp<now){await provider.send('evm_setNextBlockTimestamp',[now]);await provider.send('evm_mine',[]);}
  }
  for(const project of projects)try{await studio.pass(project.id);}catch{console.error('Project worker paused: '+project.id);}
 }
 finally{active=false;}
},5000);
const stop=async()=>{clearInterval(timer);server.close();await Promise.allSettled(Object.values(pools).map(p=>p.end()));provider.destroy();process.exit();};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
