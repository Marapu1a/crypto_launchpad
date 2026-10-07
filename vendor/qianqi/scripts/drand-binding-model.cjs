// Research model only: not a controller, BLS verifier, finality oracle or vault.
const {ethers}=require('ethers');
const {roundAtOrAfter}=require('./drand-feasibility.cjs');
const GENESIS=1727521075n, PERIOD=3n;
const timeOf=r=>GENESIS+(BigInt(r)-1n)*PERIOD;
class BindingModel {
  constructor({lead=3600n,mode='seal-time',verifier}={}) {
    if(!['seal-time','schedule'].includes(mode)||lead<=0n)throw Error('configuration');
    this.lead=lead;this.mode=mode;this.verifier=verifier;this.draws=new Map();
  }
  freeze({id,context,chainTime,scheduleClose,budget=100n}) {
    if(this.draws.has(id))throw Error('already bound');
    const anchor=this.mode==='schedule'?scheduleClose:chainTime;
    if(typeof anchor!=='bigint'||budget<=0n)throw Error('input');
    const round=roundAtOrAfter(anchor+this.lead+1n),targetTime=timeOf(round);
    if(targetTime<=chainTime)throw Error('target due');
    // Wall time deliberately absent: an L2 contract does not have this oracle.
    const d={id,context,round,targetTime,freezeTime:chainTime,budget,phase:'BOUND',seed:null};
    this.draws.set(id,d);return structuredClone(d);
  }
  deliver(id,proof) {
    const d=this.draws.get(id);if(!d)throw Error('unknown draw');
    const seed=this.verifier(d.round,proof); // Stand-in, not cryptographic proof.
    if(d.seed!==null){if(d.seed!==seed)throw Error('different seed');return seed;}
    d.seed=seed;d.phase='PROVEN';return seed;
  }
  finish(id,{fail=false}={}) {
    const d=this.draws.get(id);if(d?.phase!=='PROVEN')throw Error('not proven');
    if(fail)throw Error('simulated settlement failure');d.phase='TERMINAL';
  }
  snapshot(){return structuredClone(this.draws);}
  restore(snapshot){this.draws=structuredClone(snapshot);}
}
// Diagnostic only. Does not block calls and must never be mistaken for enforcement.
function diagnose(binding,{wallAtFreeze,finalizedAt}) {
  return {knownAtFreeze:binding.targetTime<=wallAtFreeze,
    revealedBeforeFinality:finalizedAt===null||binding.targetTime<finalizedAt};
}
const outcomeDomain=(context,seed)=>ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','bytes32'],[context,seed]));
module.exports={BindingModel,diagnose,timeOf,GENESIS,outcomeDomain};
