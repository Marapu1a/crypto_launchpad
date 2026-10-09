import fs from 'node:fs';
import {createRequire} from 'node:module';
const root=fs.realpathSync('/opt/crypto-launchpad/qianqi-current');
const require=createRequire(root+'/package.json');
const {hash}=require(root+'/server/adapters/qianqi/runtime/scripts/direct-buy.cjs');
try{
 const binding=JSON.parse(fs.readFileSync('/etc/crypto-launchpad/existing-qianqi/executor.json'));
 for(const [file,key] of [['configFile','configHash'],['profileFile','profileHash'],['indexConfigFile','indexConfigHash']]){
  if(hash(JSON.parse(fs.readFileSync(binding[file])))!==binding[key])throw Error();
 }
 console.log('PINNED_CONFIG_OK');
}catch{console.error('Backup configuration preflight refused');process.exitCode=1;}
