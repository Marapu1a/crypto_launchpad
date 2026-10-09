// One dispatch table for validation, indexing and local Pons consumers.
const ALL=[require('./pons-curve-buy.cjs'),require('./pons-v4-buy.cjs'),require('./pons-batch-route.cjs'),require('./pons-launch-buy.cjs'),require('./pons-pool-batch-buy.cjs'),require('./pons-zeroex-buy.cjs'),require('./pons-entrypoint-buy.cjs')];
const get=schema=>ALL.find(p=>p.SCHEMA===schema)||null;
const pool=schema=>{const p=get(schema);return p?.FIELDS.includes('manager')?p:null;};
module.exports={ALL,get,pool};
