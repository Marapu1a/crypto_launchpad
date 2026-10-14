// Shared operational policy. Adapters translate observations; token names never select behaviour.
const DEFAULTS=Object.freeze({activeMs:15000,quietMs:300000,quietPasses:3,maxBackoffMs:600000});
function createServiceCadence({activeMs=DEFAULTS.activeMs,quietMs=DEFAULTS.quietMs,quietPasses=DEFAULTS.quietPasses,random=Math.random}={}){
 for(const n of [activeMs,quietMs,quietPasses])if(!Number.isSafeInteger(n)||n<1)throw Error('Invalid service cadence');
 let quiet=0,failures=0;
 return observation=>{
  const status=observation?.status;
  if(status==='unavailable'){
   quiet=0;const base=[60000,120000,300000,DEFAULTS.maxBackoffMs][Math.min(failures++,3)];
   return {mode:'backoff',delayMs:Math.min(DEFAULTS.maxBackoffMs,Math.round(base*(1+random()*.1)))};
  }
  failures=0;
  if(status==='active'&&observation.continueImmediately===true){quiet=0;return {mode:'active',delayMs:0};}
  quiet=status==='idle'?quiet+1:0;
  return quiet>=quietPasses?{mode:'quiet',delayMs:Math.max(activeMs,quietMs)}:{mode:'active',delayMs:activeMs};
 };
}
module.exports={DEFAULTS,createServiceCadence};
