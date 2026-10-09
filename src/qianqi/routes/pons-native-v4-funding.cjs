// Adapted pure route verifier from rh_project 11a050d; no CLI or production configuration.
// Exact v4 funding boundary: the swap caller's settled input and returned delta,
// not vault turnover inside a hook, determine the project quote payment.
const E=require('ethers'),ABI=E.AbiCoder.defaultAbiCoder(),low=x=>String(x).toLowerCase(),check=(v,m)=>{if(!v)throw Error('Native v4 funding: '+m);};
const MANAGER='0x8366a39cc670b4001a1121b8f6a443a643e40951',HOOK='0xd1bcbcca41f3bdb6b4812652959c6df725ea2ac0';
function verify({m,frames,transfers,buy,event,buyer}){
 const swaps=frames.filter(f=>f.node.type==='CALL'&&low(f.node.to)===MANAGER&&f.node.input.slice(0,10)==='0xf3cd914c');check(swaps.length===1,'one swap');const swap=swaps[0],driver=low(swap.node.from);
 const types=['tuple(address,address,uint24,int24,address)','tuple(bool,int256,uint160)','bytes'],data='0x'+swap.node.input.slice(10),args=ABI.decode(types,data);check(low(ABI.encode(types,args))===low(data),'canonical swap');const [key,params,hookData]=args;
 const native=low(key[0])===E.ZeroAddress;check((native||low(key[0])===low(m.weth))&&low(key[1])===low(m.quote)&&key[2]===100n&&key[3]===1n&&low(key[4])===(native?E.ZeroAddress:HOOK),'pool key');check(params[0]===true&&params[1]<0n&&params[2]===4295128740n,'exact input swap');
 const input=-params[1],delta=BigInt(swap.node.output);check(BigInt.asIntN(128,delta>>128n)===-input&&BigInt.asIntN(128,delta)===event.quoteIn,'caller delta');
 const own=selector=>frames.filter(f=>f.node.type==='CALL'&&low(f.node.from)===driver&&low(f.node.to)===MANAGER&&f.node.input.slice(0,10)===selector);
 const settle=own('0x11da60b4');check(settle.length===1&&settle[0].node.input==='0x11da60b4'&&BigInt(settle[0].node.output)===input&&BigInt(settle[0].node.value||0)===(native?input:0n),'caller settlement');
 const take=own('0x0b0d9c09');check(take.length===1,'one output take');const [currency,to,amount]=ABI.decode(['address','address','uint256'],'0x'+take[0].node.input.slice(10));check(low(currency)===low(m.quote)&&low(to)===buyer&&amount===event.quoteIn,'caller output');
 // Hook-local transfers may include redeem/deposit activity. Nothing from that
 // subtree is added to the buyer's quote basis, and no such movement may escape it.
 const external=transfers.filter(t=>!t.path.startsWith(swap.path+'.'));
 const quote=external.filter(t=>t.asset===low(m.quote)),weth=external.filter(t=>t.asset===low(m.weth));
 check(external.every(t=>[low(m.quote),low(m.token),low(m.weth)].includes(t.asset)),'unrelated asset outside funding');
 check(quote.length===2&&low(quote[0].args.from)===MANAGER&&low(quote[0].args.to)===buyer&&quote[0].args.value===event.quoteIn&&quote[0].path.startsWith(take[0].path+'.')&&low(quote[1].args.from)===buyer&&low(quote[1].args.to)===low(m.curve)&&quote[1].args.value===event.quoteIn&&quote[1].path.startsWith(buy.path+'.'),'quote take/payment');
 if(native)check(weth.length===0,'unexpected wrap');
 else{
  check(weth.length===2&&low(weth[0].args.from)===E.ZeroAddress&&low(weth[0].args.to)===driver&&weth[0].args.value===input&&low(weth[1].args.from)===driver&&low(weth[1].args.to)===MANAGER&&weth[1].args.value===input,'wrapped input');
  const deposits=frames.filter(f=>f.node.type==='CALL'&&low(f.node.to)===low(m.weth)&&f.node.input==='0xd0e30db0');check(deposits.length===1&&low(deposits[0].node.from)===driver&&BigInt(deposits[0].node.value)===input&&weth[0].path.startsWith(deposits[0].path+'.'),'wrap binding');
 }
 return true;
}
module.exports={verify,MANAGER};
