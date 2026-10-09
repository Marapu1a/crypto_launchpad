// Pure operational diagnostic, not an on-chain gate or a consensus/future-liveness proof.
const GENESIS=1727521075n,PERIOD=3n;
function assessDrandTiming({now,latestTimestamp,finalizedTimestamp,beaconRound,lead,maxClockLag,maxClockAhead,maxFinalizedLag,maxBeaconLag}){
 const values=[now,latestTimestamp,finalizedTimestamp,beaconRound,lead,maxClockLag,maxClockAhead,maxFinalizedLag,maxBeaconLag];
 if(values.some(x=>typeof x!=='bigint'||x<0n)||beaconRound===0n||lead===0n||latestTimestamp<GENESIS||finalizedTimestamp>latestTimestamp)throw Error('Invalid timing input');
 const beaconTime=GENESIS+(beaconRound-1n)*PERIOD;
 const targetRound=1n+(latestTimestamp+lead+1n-GENESIS+PERIOD-1n)/PERIOD;
 const targetTime=GENESIS+(targetRound-1n)*PERIOD;
 const reasons=[];
 if(now-latestTimestamp>maxClockLag)reasons.push('staleChainClock');
 if(latestTimestamp-now>maxClockAhead)reasons.push('chainClockAhead');
 if(now-finalizedTimestamp>maxFinalizedLag)reasons.push('finalityLag');
 if(now-beaconTime>maxBeaconLag)reasons.push('staleBeacon');
 if(beaconTime>now+maxClockAhead)reasons.push('beaconClockAhead');
 if(targetTime<=now||targetRound<=beaconRound)reasons.push('targetAlreadyKnown');
 // The observed lag is not a bound on future finality. Headroom is diagnostic only.
 if(targetTime-now<=now-finalizedTimestamp)reasons.push('insufficientObservedHeadroom');
 return {status:reasons.length?'wait':'observedHealthy',reasons,targetRound:targetRound.toString(),targetTime:targetTime.toString(),authorizationToFreeze:false};
}
module.exports={assessDrandTiming};
