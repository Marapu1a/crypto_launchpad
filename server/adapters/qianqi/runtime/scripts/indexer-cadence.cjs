// Retry pacing only; successful catch-up keeps its existing path.
function retryDelay(pollMs,failures,random=Math.random){
 const base=Math.max(pollMs,[60000,120000,300000,600000][Math.min(Math.max(1,failures)-1,3)]);
 return Math.min(Math.max(pollMs,600000),Math.round(base*(1+random()*.1)));
}
module.exports={retryDelay};
