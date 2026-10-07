const {hash}=require('./direct-buy.cjs');
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function buildIndexConfigs(config){
 if(!config.indexer||!config.buyPolicy||config.cutoffMode!=='FINALIZED_CHECKPOINT'||config.buyPolicyMode!=='admitted'||'publicStatus' in config)throw Error('Admitted scheduler config required');
 const schedulerConfig=structuredClone(config),indexConfig={...structuredClone(config),publicStatus:true};
 return freeze({schedulerConfig,indexConfig});
}
function validateIndexConfig(schedulerConfig,indexConfig){
 const expected=buildIndexConfigs(schedulerConfig).indexConfig;
 if(hash(expected)!==hash(indexConfig))throw Error('Shared index config mismatch');
 return indexConfig;
}
module.exports={buildIndexConfigs,validateIndexConfig};
