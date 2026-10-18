// V3 starts at the token's launch block, not the earlier program deployment.
// Old policies retain exactly their existing contract schedule.
export async function drawEligibleAt(provider,policy,kind,cycle,lastTerminal,interval){
 let start=BigInt(lastTerminal);
 if(policy.template.config.schedule?.cadence==='launch-then-terminal-30d'&&kind==='short'&&BigInt(cycle)===0n){
  const launch=await provider.getBlock(policy.anchor.number+1);
  if(!launch||launch.parentHash?.toLowerCase()!==policy.anchor.hash.toLowerCase()||!Number.isSafeInteger(launch.timestamp)||launch.timestamp<=0)throw Error('Missing canonical launch schedule anchor');
  if(BigInt(launch.timestamp)>start)start=BigInt(launch.timestamp);
 }
 return start+BigInt(interval);
}
