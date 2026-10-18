import {getAddress,HDNodeWallet,keccak256,ZeroAddress} from 'ethers';
import pins from '../../config/pons-production-pins.json' with {type:'json'};
import {validatePolicy,finalizedObservation} from '../../src/worker/production-policy.mjs';
import {check,same} from './store.mjs';

// Reviewed helper from the 2026-10-18 read-only Pons investigation.
export const PW_EXTERNALS={...Object.fromEntries(['factory','router','escrow','hook'].map(k=>[k,pins.pins[k]])),launchDeployer:{address:'0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42',codeHash:'0xeade22566c766377f6adfb99534f2772251efad9568642c0704a7051418e624c'}};
const fixture=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0");
const testWallets=new Set(Array.from({length:20},(_,i)=>fixture.deriveChild(i).address.toLowerCase()));
export function validatePwProductionProfile(p,buildHash){
 check(p?.schema==='pw-production-profile-v1'&&p.mode==='production'&&p.executionEnabled===false,'Explicit PW production profile required');
 check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id)&&p.chainId===4663,'PW production identity required');
 check(p.buildHash===buildHash,'PW build approval changed');
 for(const role of ['owner','executor','publisher','project']){const a=getAddress(p[role]);check(a!==ZeroAddress&&!testWallets.has(a.toLowerCase()),'Non-fixture production wallets required');}
 check(new Set(['owner','executor','publisher'].map(k=>p[k].toLowerCase())).size===3,'Separate owner/executor/publisher required');
 check(Object.keys(p.externals??{}).length===5,'PW external pins required');
 for(const [role,pin] of Object.entries(PW_EXTERNALS))check(same(p.externals[role]?.address,pin.address)&&same(p.externals[role]?.codeHash,pin.codeHash),'Unreviewed PW external: '+role);
 for(const k of ['maxGasLimit','maxFeePerGas','totalNativeLimit','nativeFloor'])check(typeof p[k]==='string'&&/^[1-9]\d*$/.test(p[k]),'Explicit PW gas budget required');
 validatePolicy({schema:'short-production-policy-v1',chainId:4663,projectId:p.id,executor:p.executor,publisher:p.publisher,buildHash,anchor:p.anchor,contracts:p.externals,timing:p.timing,limits:{maxGasPrice:p.maxFeePerGas,maxGasLimit:p.maxGasLimit,nativeFloor:p.nativeFloor}});
 return p;
}
export async function verifyPwProductionEnvironment(provider,p,buildHash,{now=Math.floor(Date.now()/1000)}={}){
 validatePwProductionProfile(p,buildHash);
 check((await provider.getNetwork()).chainId===4663n,'Wrong PW production chain');
 const client=await provider.send('web3_clientVersion',[]);
 check(typeof client==='string'&&!/hardhat|anvil|ganache/i.test(client),'Local development node is not production');
 const o=await finalizedObservation(provider,now);
 check(o.finalized.number>=p.anchor.number&&same((await provider.getBlock(p.anchor.number))?.hash,p.anchor.hash),'PW production anchor changed');
 check(now-o.latest.timestamp<=p.timing.clockLag&&o.latest.timestamp-now<=p.timing.clockAhead&&now-o.finalized.timestamp<=p.timing.finalizedLag,'PW production clock/finality outside policy');
 for(const pin of Object.values(p.externals))check(same(keccak256(await provider.getCode(pin.address,o.finalized.number)),pin.codeHash),'PW production external runtime changed');
 for(const role of ['owner','executor','publisher'])check(await provider.getCode(p[role],o.finalized.number)==='0x','Working roles must be EOA');
 return o;
}
