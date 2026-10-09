// Checked execution envelope for fixed native-input route families. Full trace
// and pinned runtimes, not a Transfer-only fallback. Activated only by v2 trust.
const E=require('ethers'),P=require('./pons-curve-buy.cjs');
const profiles=require('./pons-native-settlement-profiles.json'),ABI=E.AbiCoder.defaultAbiCoder(),low=x=>String(x).toLowerCase();
const check=(v,m)=>{if(!v)throw Error('Native settlement: '+m);};
const ERC=new E.Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
function decode(m,tx){const profile=profiles[low(tx.to)];check(profile&&tx.input.slice(0,10)===profile.selector,'unsupported route selector');check(!tx.authorizationList?.length&&BigInt(tx.value||0)>0n&&low(tx.from)!==low(tx.to),'native EOA envelope');return profile;}
function verify(m,row,proof,block){
 const {tx,receipt}=row,profile=decode(m,tx),sender=low(tx.from),pins={...profile.pins,[sender]:E.keccak256('0x')},trace=proof.trace;
 check(proof.transactionHash===low(tx.hash)&&proof.blockHash===low(block.hash)&&low(tx.blockHash)===low(block.hash)&&low(receipt.blockHash)===low(block.hash)&&low(receipt.transactionHash)===low(tx.hash)&&BigInt(receipt.status)===1n,'purchase binding');
 for(const k of ['quote','token','curve',...(pins[low(m.weth)]?['weth']:[])])check(pins[low(m[k])]===low(m.codeHashes[k]),'project runtime pins');
 check(proof.codeHashes?.[sender]===pins[sender]&&proof.parentCodeHashes?.[sender]===pins[sender],'EOA payer runtime');
 check(trace.type==='CALL'&&low(trace.from)===sender&&low(trace.to)===low(tx.to)&&low(trace.input)===low(tx.input)&&BigInt(trace.value)===BigInt(tx.value),'trace envelope');
 const frames=[],logs=new Map(),native=new Map();const delta=(a,n)=>native.set(a,(native.get(a)||0n)+n);
 function walk(n,parent,path){
  check(['CALL','STATICCALL','DELEGATECALL'].includes(n.type),'unsupported execution');
  const probe=!!n.error&&!parent?.reverted&&low(tx.to)==='0x6131b5fae19ea4f9d964eac0408e4408b66337b5'&&n.type==='CALL'&&low(n.from)==='0x8f10b468b06c6fd214b65f87778827f7d113f996'&&low(n.to)===low(n.from)&&n.input.slice(0,10)==='0x3ed37eda'&&BigInt(n.value||0)===0n&&E.isHexString(n.output,32);
  const reverted=!!parent?.reverted||probe;check((!n.error&&!n.revertReason)||reverted,'failed execution');
  const address=low(n.to),context=n.type==='DELEGATECALL'?parent?.context:address;
  check(context&&(!parent||low(n.from)===parent.context),'call context');
  check(pins[address]&&proof.codeHashes?.[address]===pins[address]&&proof.parentCodeHashes?.[address]===pins[address],'unreviewed/changed runtime');
  const edge=[n.type,low(n.from)===sender?'$sender':low(n.from),address===sender?'$sender':address,n.input.slice(0,10)].join('|');check(profile.edges.includes(edge),'unreviewed execution edge');
  const frame={node:n,context,path,reverted};if(!reverted)frames.push(frame);else check(!(n.logs?.length),'reverted probe logs');
  if(n.type==='CALL'&&!reverted){const value=BigInt(n.value||0);delta(low(n.from),-value);delta(address,value);}
  for(const l of n.logs||[]){const index=String(BigInt(l.index));check(!logs.has(index)&&low(l.address)===context,'log context/index');logs.set(index,{log:l,path});}
  (n.calls||[]).forEach((c,i)=>walk(c,frame,path+'.'+i));
 }
 walk(trace,null,'0');for(const [address,net]of native)check(address===sender||net>=0n,'subsidized native funding');
 check(logs.size===receipt.logs.length,'receipt log completeness');for(const l of receipt.logs){const f=logs.get(String(BigInt(l.logIndex)))?.log;check(f&&low(f.address)===low(l.address)&&low(f.data)===low(l.data)&&JSON.stringify(f.topics.map(low))===JSON.stringify(l.topics.map(low)),'receipt log mismatch');}
 const events=receipt.logs.filter(l=>low(l.address)===low(m.curve)&&l.topics[0]===P.EVENTS.getEvent('CurveBuy').topicHash);check(events.length===1&&!receipt.logs.some(l=>low(l.address)===low(m.curve)&&l.topics[0]===P.EVENTS.getEvent('CurveSell').topicHash),'one terminal BUY only');const event=P.EVENTS.parseLog(events[0]).args;
 const buys=frames.filter(f=>f.node.type==='CALL'&&low(f.node.to)===low(m.curve)&&f.node.input.slice(0,10)===P.CALL.getFunction('buy').selector);check(buys.length===1,'one buy call');const buy=buys[0],call=P.CALL.decodeFunctionData('buy',buy.node.input),buyer=low(buy.node.from);
 check(low(event.buyer)===buyer&&low(call.recipient)===low(event.recipient)&&call.quoteIn===event.quoteIn&&event.quoteIn>0n&&event.tokensOut>=call.minTokensOut,'buy call/event');check(logs.get(String(BigInt(events[0].logIndex))).path===buy.path,'curve event context');
 const transfers=receipt.logs.filter(l=>l.topics[0]===ERC.getEvent('Transfer').topicHash).map(l=>({asset:low(l.address),args:ERC.parseLog(l).args,path:logs.get(String(BigInt(l.logIndex))).path}));
 const tokens=transfers.filter(t=>t.asset===low(m.token));
 const v4=frames.some(f=>f.node.type==='CALL'&&low(f.node.to)===require('./pons-native-v4-funding.cjs').MANAGER&&f.node.input.slice(0,10)==='0xf3cd914c');
 if(v4)require('./pons-native-v4-funding.cjs').verify({m,frames,transfers,buy,event,buyer});
 else{
 check(transfers.every(t=>[low(m.quote),low(m.token),low(m.weth)].includes(t.asset)),'other asset movements');
 const quote=transfers.filter(t=>t.asset===low(m.quote)),weth=transfers.filter(t=>t.asset===low(m.weth));
 check(quote.length===2&&low(quote[0].args.to)===buyer&&quote[0].args.value===event.quoteIn&&low(quote[1].args.from)===buyer&&low(quote[1].args.to)===low(m.curve)&&quote[1].args.value===event.quoteIn&&quote[1].path.startsWith(buy.path+'.'),'exact USDG settlement');const pool=low(quote[0].args.from);
 check(weth.length===2&&low(weth[0].args.from)===E.ZeroAddress&&low(weth[1].args.from)===low(weth[0].args.to)&&low(weth[1].args.to)===pool&&weth[1].args.value===weth[0].args.value&&weth[0].args.value>0n,'exact WETH settlement');const wrapped=weth[0].args.value,wrapper=low(weth[0].args.to);
 const deposits=frames.filter(f=>f.node.type==='CALL'&&low(f.node.to)===low(m.weth)&&f.node.input==='0xd0e30db0');check(deposits.length===1&&low(deposits[0].node.from)===wrapper&&BigInt(deposits[0].node.value)===wrapped&&weth[0].path.startsWith(deposits[0].path+'.'),'native wrap binding');
 const swaps=frames.filter(f=>f.node.type==='CALL'&&low(f.node.to)===pool&&f.node.input.slice(0,10)==='0x128acb08');check(swaps.length===1&&quote[0].path.startsWith(swaps[0].path+'.')&&weth[1].path.startsWith(swaps[0].path+'.'),'funding swap settlement');const swap=swaps[0];
 const [recipient,direction,amount]=ABI.decode(['address','bool','int256','uint160','bytes'],'0x'+swap.node.input.slice(10));check(low(recipient)===buyer&&direction===true&&amount===wrapped,'funding swap input');
 const [inWeth,outQuote]=ABI.decode(['int256','int256'],swap.node.output);check(inWeth===wrapped&&outQuote===-event.quoteIn,'funding swap output');
 }
 check(tokens.length>=1&&tokens.length<=2&&low(tokens[0].args.from)===low(m.curve)&&low(tokens[0].args.to)===low(event.recipient)&&tokens[0].args.value===event.tokensOut&&tokens[0].path.startsWith(buy.path+'.'),'token delivery');
 if(tokens.length===1)check(low(event.recipient)===sender,'buyer recipient');
 else{const last=tokens[1].args,dust=event.tokensOut-last.value;check(low(last.from)===low(event.recipient)&&low(last.to)===sender&&last.value>0n&&(dust===0n||(low(tx.to)==='0x6131b5fae19ea4f9d964eac0408e4408b66337b5'&&dust===1n)),'forwarded beneficiary/dust');}
 return {payer:sender,recipient:sender,grossQuoteRaw:String(event.quoteIn)};
}
module.exports={decode,verify};
