// Operational controls never change the durable config/policy identity.
function transactionLimit(config,override){
 const value=override===undefined?config.maxTransactions:override;
 if(!Number.isInteger(value)||value<1||value>128)throw Error('Invalid transaction override');
 return value;
}
function continuation({status,pending,confirmed,waits,results}){
 if(status!=='waiting'||pending||confirmed===0||results.fundingError||results.nativeFunding?.length)return false;
 const unsafeBudget=x=>x&&typeof x==='object'&&(['error','blocked','stopped'].includes(x.status)||x.claimFailures?.length||x.failures?.length||x.budget?.reason&&x.budget.reason!=='transactionLimit'||Object.values(x).some(v=>v&&typeof v==='object'&&unsafeBudget(v)));
 if(waits.some(x=>x!=='transactionLimit')||unsafeBudget(results))return false;
 return waits.includes('transactionLimit')||['settlement','scheduler'].some(k=>results[k]?.status==='yielded');
}
function laneOrder(lastTarget,short){return String(lastTarget).toLowerCase()===String(short).toLowerCase()?['MONTHLY','SHORT']:['SHORT','MONTHLY'];}
function delayMs(result,pollSeconds){return result.status==='waiting'&&result.continueImmediately===true?0:pollSeconds*1000;}
// Slow only after repeated complete, positively idle passes. Missing data is not idle.
function serviceObservation(r){
  const x=r.results,lanes=x?.scheduler?.results;
  const idle=r.status==='waiting'&&r.reason==='poll'&&!r.continueImmediately&&r.steps?.length===0
   &&!x?.fundingError&&!x?.claimFailures?.length&&!x?.nativeFunding?.length&&!x?.notifications?.length
   &&x?.rng?.status==='complete'&&x.rng.requests?.length===0&&x.rng.failures?.length===0
   &&x?.funding?.length>0&&x.funding.every(a=>a.status==='empty')
   &&x?.scheduler?.status==='waiting'&&['SHORT','MONTHLY'].every(k=>lanes?.[k]?.status==='waiting'&&['empty','schedule','prizeFunding'].includes(lanes[k].reason));
  if(['error','blocked','paused','stopped'].includes(r.status))return {status:'unavailable'};
  if(r.status==='waiting'&&r.continueImmediately===true)return {status:'active',continueImmediately:true};
  return {status:idle?'idle':'unknown'};
}
function createEconomyDelay(pollSeconds,options={}){
 if(!Number.isInteger(pollSeconds)||pollSeconds<10||pollSeconds>3600)throw Error('Invalid poll interval');
 const next=require('../../../../shared/service-cadence.cjs').createServiceCadence({...options,activeMs:pollSeconds*1000});
 return r=>next(serviceObservation(r)).delayMs;
}
function pause(ms,signal){
 if(signal.aborted)return Promise.resolve();
 return new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});
}
module.exports={laneOrder,transactionLimit,continuation,delayMs,createEconomyDelay,pause,serviceObservation};
