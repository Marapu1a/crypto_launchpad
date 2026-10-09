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
function pause(ms,signal){
 if(signal.aborted)return Promise.resolve();
 return new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});
}
module.exports={laneOrder,transactionLimit,continuation,delayMs,pause};
