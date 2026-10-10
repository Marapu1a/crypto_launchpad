import {AbiCoder,id,keccak256,isHexString,ZeroAddress,ZeroHash} from 'ethers';
import {participantsHash} from './short-outcome.mjs';
const coder=AbiCoder.defaultAbiCoder();
const hash=(types,values)=>keccak256(coder.encode(types,values));
export function computeMonthly(context,seed,people,budget){
 if(!isHexString(context,32)||context===ZeroHash||!isHexString(seed,32)||typeof budget!=='bigint'||budget<=0n||budget>=1n<<256n||!Array.isArray(people)||!people.length||people.length>1000)throw Error('Invalid monthly input');
 const ph=participantsHash(people),weights=people.map(p=>{const x=BigInt(p.lastAttempt)-BigInt(p.firstAttempt)+1n;return (1n<<128n)*x/(x+1n);});
 const random=tag=>BigInt(hash(['bytes32','bytes32','bytes32'],[id(tag),context,seed]));
 const pays=random('MONTHLY_PAYOUT_V2')<3n*(1n<<254n);
 const total=weights.reduce((a,b)=>a+b,0n),point=random('MONTHLY_WINNER_V2')*total/(1n<<256n);
 let offset=0n,winner=ZeroAddress;
 for(let i=0;i<people.length;i++){offset+=weights[i];if(pays&&winner===ZeroAddress&&point<offset)winner=people[i].wallet.toLowerCase();}
 const admitted=pays?BigInt(people.length):0n;
 return {winner,admitted,awarded:pays?budget:0n,resultHash:hash(['bytes32','bytes32','bytes32','bytes32','address','uint256','uint256'],[id('LAUNCHPAD_MONTHLY_RESULT_V2'),context,seed,ph,winner,admitted,budget])};
}
