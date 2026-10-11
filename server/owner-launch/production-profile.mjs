import {getAddress,keccak256,ZeroAddress} from 'ethers';
import pins from '../../config/pons-production-pins.json' with {type:'json'};
import {validatePolicy,finalizedObservation} from '../../src/worker/production-policy.mjs';
import {UUID} from '../../src/launch/template.mjs';
import {check,same} from './store.mjs';

export const DRAW_BUILD='0x2824a5d90a5160f42449e82ad770e57d68c9124dbf99177da396b74dd853f640';
const fixtureOwners=new Set(['0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266','0x70997970c51812dc3a010c7d01b50e0d17dc79c8']);
export function validateProductionProfile(p){
 check(p?.schema==='owner-production-profile-v2'&&p.mode==='production'&&UUID.test(p.id),'Explicit production profile required');
 check(p.chainId===4663&&p.instanceId==='production:'+p.id,'Production profile identity mismatch');
 for(const role of ['owner','executor','publisher']){
  const a=getAddress(p[role]);check(a!==ZeroAddress&&!fixtureOwners.has(a.toLowerCase()),'Separate non-fixture wallets required');
 }
 check(new Set(['owner','executor','publisher'].map(k=>p[k].toLowerCase())).size===3,'Separate wallets required');
 check(Object.keys(p.externals??{}).length===Object.keys(pins.pins).length,'Unexpected external contracts');
 for(const [role,pin] of Object.entries(pins.pins))check(same(p.externals[role]?.address,pin.address)&&same(p.externals[role]?.codeHash,pin.codeHash),'Unreviewed external pin: '+role);
 validatePolicy({schema:'short-production-policy-v1',chainId:4663,projectId:p.id,executor:p.executor,publisher:p.publisher,buildHash:DRAW_BUILD,anchor:p.anchor,contracts:p.externals,timing:p.timing,limits:p.limits});
 const money=x=>typeof x==='string'&&/^(0|[1-9]\d*)$/.test(x);
 check(money(p.totalNativeLimit)&&BigInt(p.totalNativeLimit)>0n,'Explicit total budget required');
 for(const role of ['executor','publisher'])check(money(p.funding?.[role]),'Explicit funding required');
 check(BigInt(p.funding.executor)+BigInt(p.funding.publisher)<BigInt(p.totalNativeLimit),'Funding exhausts deployment budget');
 return p;
}

// A public chain ID alone is insufficient: require a pinned canonical anchor,
// actual finalized observation and reviewed runtimes. No modeled finality here.
export async function verifyProductionEnvironment(provider,p,{now=Math.floor(Date.now()/1000)}={}){
 validateProductionProfile(p);
 check((await provider.getNetwork()).chainId===4663n,'Wrong production network');
 const client=await provider.send('web3_clientVersion',[]);
 check(typeof client==='string'&&!/hardhat|anvil|ganache/i.test(client),'Local development node is not production');
 const o=await finalizedObservation(provider,now);
 check(o.finalized.number>=p.anchor.number&&same((await provider.getBlock(p.anchor.number))?.hash,p.anchor.hash),'Production anchor changed or not finalized');
 check(now-o.latest.timestamp<=p.timing.clockLag&&o.latest.timestamp-now<=p.timing.clockAhead&&now-o.finalized.timestamp<=p.timing.finalizedLag,'Production clock/finality outside policy');
 for(const pin of Object.values(p.externals))check(same(keccak256(await provider.getCode(pin.address,o.finalized.number)),pin.codeHash),'Production external runtime changed');
 for(const role of ['owner','executor','publisher'])check(await provider.getCode(p[role])==='0x','This launch requires ordinary EOA wallets: '+role);
 return o;
}

export function walletGuard(p){return {anchor:p.anchor,timing:p.timing,externals:p.externals};}
