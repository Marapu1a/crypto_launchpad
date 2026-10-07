// Explicit genesis profile combining already qualified route families.
// Does not admit wallet batches around v4, relayers or arbitrary aggregators.
const B=require('./pons-batch-route.cjs'),V=require('./pons-v4-buy.cjs');
const SCHEMA='direct-buy-pons-launch-v1',ID='rh-pons-curve-batch-ur-v1';
const FIELDS=[...new Set([...B.FIELDS,...V.FIELDS])];
function validate(m){
 if(m.schema!==SCHEMA||m.routeVersion!==ID)throw Error('Wrong Pons launch profile');
 B.validate({...m,schema:B.SCHEMA,routeVersion:B.ID});
 V.validate({...m,schema:V.SCHEMA,routeVersion:V.ID});
 if(new Set(FIELDS.map(k=>m[k].toLowerCase())).size!==FIELDS.length)throw Error('Overlapping launch dependencies');
}
async function validateBindings(m,rpc,tag){
 const record=await B.validateBindings(m,rpc,tag);
 await V.validateBindings(m,rpc,tag,record);
}
function decode(m,tx,receipt,block){
 return [...B.decode(m,tx,receipt,block),...V.decodePool(m,tx,receipt)].sort((a,b)=>a.logIndex-b.logIndex);
}
module.exports={SCHEMA,ID,FIELDS,validate,validateBindings,decode};
