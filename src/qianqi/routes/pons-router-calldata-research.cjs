// Adapted pure route verifier from rh_project 11a050d; no CLI or production configuration.
// Recovered signature, independently checked by selector and canonical encoding.
// Field labels are local names, not a claim of verified source semantics.
const E=require('ethers');
const ABI=new E.Interface(['function swap((uint8 kind,address inputToken,address outputToken,address pool,uint24 fee,int24 spacing,address hook,bytes extra,address aux,bytes32 tag)[] steps,address feeToken,uint256 amountIn,uint256 minReturn,uint256 deadline) payable']);
const low=s=>s.toLowerCase(),check=(x,s)=>{if(!x)throw Error(s);};
function decode(m,tx){
 const a=ABI.decodeFunctionData('swap',tx.input);
 check(low(ABI.encodeFunctionData('swap',a))===low(tx.input),'Noncanonical router calldata');
 const native=BigInt(tx.value)>0n;
 check(a.amountIn>0n&&a.minReturn>0n&&a.deadline>0n,'Invalid amount/minimum/deadline');
 check(native?low(a.feeToken)===E.ZeroAddress&&a.amountIn===BigInt(tx.value):low(a.feeToken)===low(m.quote),'Input asset/value mismatch');
 check(a.steps.length===(native?2:1),'Split/multiple route steps');
 for(const s of a.steps)check(s.hook===E.ZeroAddress&&s.aux===E.ZeroAddress&&s.tag===E.ZeroHash,'Unknown route options');
 const buy=a.steps.at(-1);
 check(buy.kind===27n&&low(buy.inputToken)===low(m.quote)&&low(buy.outputToken)===low(m.token)&&low(buy.pool)===low(m.curve)&&buy.fee===0n&&buy.spacing===0n&&buy.extra===E.toBeHex(1,32),'Unsupported curve step');
 if(native){const f=a.steps[0];check(f.kind===1n&&low(f.inputToken)===low(m.weth)&&low(f.outputToken)===low(m.quote)&&low(f.pool)===low(m.fundingPool)&&f.fee===100n&&f.spacing===1n&&f.extra==='0x','Unsupported funding step');}
 return {native,amountIn:a.amountIn,minReturn:a.minReturn,deadline:a.deadline};
}
module.exports={ABI,decode};
