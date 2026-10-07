// Versioned adapter identifiers. New supported ids require a reviewed decoder release.
// Id is a specification/version commitment, NOT a digest/proof of executable code.
const {id,AbiCoder,keccak256}=require('ethers');
const {validateRouteExtensionCandidate}=require('./direct-buy.cjs');
const pons=require('./pons-profiles.cjs').ALL;
const names=['rh-ur-10-060b0e-v1','rh-ur-10-060c0f-v1','rh-ur-0a10-060b0e-v1',require('./pair-auto-buy.cjs').ID,require('./infinity-buy.cjs').ID,...pons.map(p=>p.ID)];
const routesOf=m=>m.routes||[{id:m.routeVersion,fromBlock:0}];
const adapterId=name=>{if(!names.includes(name))throw Error('Unsupported adapter '+name);return id(name);};
const initialAdapters=m=>routesOf(m).map(r=>adapterId(r.id));
const genesisAdaptersHash=m=>keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32[]'],[initialAdapters(m)]));
const commitment=(previous,adapter,fromBlock)=>keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','bytes32','uint256'],[previous,1,adapter,fromBlock]));
function extend(previous,adapter,fromBlock,announcedAtBlock){
 if(previous.schema===require('./infinity-buy.cjs').SCHEMA||pons.some(p=>previous.schema===p.SCHEMA))return null; // Genesis admission only; no implicit route upgrade.
 const name=names.find(n=>id(n)===adapter.toLowerCase());
 if(!name||pons.some(p=>p.ID===name))return null;
 const next={...structuredClone(previous),schema:'direct-buy-v2',routeVersion:'scheduled-routes-v1',routes:[...routesOf(previous),{id:name,fromBlock}]};
 validateRouteExtensionCandidate(previous,next,announcedAtBlock);return next;
}
module.exports={adapterId,initialAdapters,genesisAdaptersHash,commitment,extend,routesOf};
