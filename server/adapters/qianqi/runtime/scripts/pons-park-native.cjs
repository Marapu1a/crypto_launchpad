// Narrow, versioned native Park route. Never activated by the legacy adapter.
const E=require('ethers'),P=require('./pons-curve-buy.cjs'),A=require('./pons-channel-attribution.cjs');
const ROUTER='0x9689992f5b5c09447f15906d8d11214944488341',IMPL='0xe419c052515cad3166988a774d9231969fd83359',POOL='0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca',TIP='0x569319680e2f921a23340d9a223c48f7b07c55bd',FEE='0x6fb4460e4bebf662fcd9bfa5ce6d6231732bb86c';
const ACCOUNT='0x63c0c19a282a1b52b07dd5a65b58948a07dae32b',ACCOUNT_CODE=E.keccak256('0xef0100'+ACCOUNT.slice(2));
const ABI=E.AbiCoder.defaultAbiCoder(),low=x=>String(x).toLowerCase(),check=(v,m)=>{if(!v)throw Error('Park native: '+m);};
function canonical(types,data){const v=ABI.decode(types,data);check(low(ABI.encode(types,v))===low(data),'noncanonical calldata');return v;}
function decode(m,tx){
 check(!tx.authorizationList?.length,'authorization-bearing transaction');
 let input=tx.input,value=BigInt(tx.value||0),self=low(tx.from)===low(tx.to);
 if(self){check(input.slice(0,10)==='0xe9ae5c53'&&value===0n,'self envelope');const [mode,payload]=canonical(['bytes32','bytes'],'0x'+input.slice(10));check(mode==='0x01'+'00'.repeat(31),'self execution mode');const [calls]=canonical(['tuple(address target,uint256 value,bytes callData)[]'],payload);check(calls.length===1&&low(calls[0].target)===ROUTER,'self call count/target');input=calls[0].callData;value=calls[0].value;}
 else check(low(tx.to)===ROUTER,'router');
 check(input.slice(0,10)==='0x3e0f9c3c'&&value>0n,'native command selector/value');
 const [commands,args,deadline]=canonical(['bytes','bytes[]','uint256'],'0x'+input.slice(10));const hasTip=commands==='0x05220039';check((hasTip&&args.length===4)||(commands==='0x220039'&&args.length===3),'command sequence');let tip=0n;if(hasTip){const [asset,tipTo,amount]=canonical(['address','address','uint256'],args[0]);check(asset===E.ZeroAddress&&low(tipTo)===TIP&&amount<value,'native tip');tip=amount;}const offset=hasTip?1:0;
 const [affiliates,bps]=canonical(['address[]','uint256[]'],args[offset]);check(affiliates.length>0&&affiliates.length===bps.length&&bps.every(x=>x>0n)&&bps.reduce((a,b)=>a+b,0n)<10000n,'affiliate fee');
 const [recipient,amount,minQuote,path,payer]=canonical(['address','uint256','uint256','bytes','bool'],args[offset+1]);
 check(BigInt(recipient)===2n&&amount===(1n<<255n)&&minQuote===0n&&payer===false,'funding commands');
 check(low(path)===low(m.weth)+'000064'+low(m.quote).slice(2)+POOL.slice(2),'funding path');
 const [token,minTokens]=canonical(['address','uint256'],args[offset+2]);check(low(token)===low(m.token),'terminal token');
 return {input,value,self,deadline,minTokens,tip,hasTip,feeBps:bps.reduce((a,b)=>a+b,0n)};
}
function verify(m,row,proof,block){
 const {tx,receipt}=row,shape=decode(m,tx),sender=low(tx.from),trace=proof.trace;
 check(proof.transactionHash===low(tx.hash)&&proof.blockHash===low(block.hash)&&low(tx.blockHash)===low(block.hash)&&low(receipt.blockHash)===low(block.hash)&&low(receipt.transactionHash)===low(tx.hash)&&BigInt(receipt.status)===1n,'purchase binding');
 check(shape.deadline>=BigInt(block.timestamp),'expired deadline');
 const pins={...require('./pons-park-native-pins.json')};
 for(const k of ['quote','token','curve','weth'])check(pins[low(m[k])]===low(m.codeHashes[k]),'project runtime pins');
 pins[sender]=shape.self?ACCOUNT_CODE:E.keccak256('0x');if(shape.self){const code='0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0';check(proof.codeHashes?.[ACCOUNT]===code&&proof.parentCodeHashes?.[ACCOUNT]===code,'account implementation');}
 check(trace.type==='CALL'&&low(trace.from)===sender&&low(trace.to)===low(tx.to)&&low(trace.input)===low(tx.input)&&BigInt(trace.value||0)===BigInt(tx.value||0),'trace envelope');
 const frames=[],logs=new Map();
 function walk(n,parent,path){
  check(!n.error&&!n.revertReason&&['CALL','DELEGATECALL','STATICCALL'].includes(n.type),'execution failure/type');
  const address=low(n.to),context=n.type==='DELEGATECALL'?parent?.context:address;
  check(context&&(!parent||low(n.from)===parent.context),'execution context');
  check(pins[address]&&proof.codeHashes?.[address]===pins[address]&&proof.parentCodeHashes?.[address]===pins[address],'unreviewed/changed runtime');
  if(n.type==='DELEGATECALL')check((context===ROUTER&&address===IMPL)||(context===low(m.weth)&&address==='0xc6b81b429797e0f555440b70cd99e032d7ae947e')||(context===low(m.quote)&&address==='0x68184c449e1a8f34fa18d289737129fd27b66f8f'),'delegate context');
  const edge=[n.type,low(n.from)===sender?'$sender':low(n.from),address===sender?'$sender':address,n.input.slice(0,10)].join('|');check(require('./pons-park-native-edges.json').includes(edge),'unreviewed execution edge');
  const frame={node:n,context,path};frames.push(frame);
  for(const log of n.logs||[]){const i=String(BigInt(log.index));check(!logs.has(i)&&low(log.address)===context,'trace log context/index');logs.set(i,{log,path});}
  (n.calls||[]).forEach((c,i)=>walk(c,frame,path+'.'+i));
 }
 walk(trace,null,'0');check(proof.codeHashes?.[sender]===pins[sender]&&proof.parentCodeHashes?.[sender]===pins[sender],'payer code');
 check(logs.size===receipt.logs.length,'receipt log completeness');for(const l of receipt.logs){const f=logs.get(String(BigInt(l.logIndex)))?.log;check(f&&low(f.address)===low(l.address)&&low(f.data)===low(l.data)&&JSON.stringify(f.topics.map(low))===JSON.stringify(l.topics.map(low)),'receipt log mismatch');}
 const route=shape.self?trace.calls?.[0]:trace;check(!shape.self||trace.calls.length===1,'extra self calls');check(low(route.to)===ROUTER&&low(route.from)===sender&&low(route.input)===low(shape.input)&&BigInt(route.value)===shape.value,'router envelope');
 check(route.calls?.length===1&&route.calls[0].type==='DELEGATECALL'&&low(route.calls[0].to)===IMPL,'proxy execution');
 const observed=A.inspect(m,tx,receipt);check(observed.events.length===1,'one curve buy');const event=observed.events[0];
 check(!receipt.logs.some(l=>low(l.address)===low(m.curve)&&l.topics[0]===P.EVENTS.getEvent('CurveSell').topicHash),'mixed buy/sell');
 const buys=frames.filter(f=>f.node.type==='CALL'&&low(f.node.to)===low(m.curve)&&f.node.input?.slice(0,10)===P.CALL.getFunction('buy').selector);check(buys.length===1,'one buy call');const buy=buys[0],call=P.CALL.decodeFunctionData('buy',buy.node.input);
 check(low(buy.node.from)===ROUTER&&event.curveCaller===ROUTER&&event.curveRecipient===sender&&low(call.recipient)===sender&&String(call.quoteIn)===event.quoteInRaw&&BigInt(event.tokensOutRaw)>=shape.minTokens,'beneficiary/amount/minimum');
 check(logs.get(event.logIndex)?.path===buy.path,'event outside buy');
 const expected=[[m.quote,POOL,ROUTER,event.quoteInRaw],[m.quote,ROUTER,m.curve,event.quoteInRaw],[m.token,m.curve,sender,event.tokensOutRaw]];
 check(observed.transfers.length===expected.length,'extra project transfer');expected.forEach(([asset,from,to,amount],i)=>{const t=observed.transfers[i];check(t.asset===low(asset)&&t.from===low(from)&&t.to===low(to)&&t.amountRaw===amount,'project settlement');});
 check(logs.get(observed.transfers[1].logIndex)?.path.startsWith(buy.path+'.'),'quote outside buy');
 const native=frames.filter(f=>f.node.type==='CALL'&&low(f.node.from)===ROUTER&&BigInt(f.node.value||0)>0n).map(f=>f.node);
 check(native.length===(shape.hasTip?3:2),'native payment count');if(shape.hasTip)check(low(native[0].to)===TIP&&native[0].input==='0x'&&BigInt(native[0].value)===shape.tip&&!(native[0].calls?.length)&&!(native[0].logs?.length),'tip settlement');
 const fee=native[shape.hasTip?1:0],wrap=native[shape.hasTip?2:1];
 check(low(fee.to)===FEE&&fee.input.slice(0,10)==='0x98b1e06a'&&!(fee.calls?.length),'fee settlement');
 check(low(wrap.to)===low(m.weth)&&wrap.input==='0xd0e30db0','ETH wrap');
 const wrapped=BigInt(wrap.value);check(native.reduce((a,c)=>a+BigInt(c.value),0n)===shape.value&&wrapped>0n,'native conservation');
 const erc=new E.Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
 const weth=receipt.logs.filter(l=>low(l.address)===low(m.weth)&&l.topics[0]===erc.getEvent('Transfer').topicHash).map(l=>erc.parseLog(l).args);
 check(weth.length===2&&low(weth[0].from)===E.ZeroAddress&&low(weth[0].to)===ROUTER&&weth[0].value===wrapped&&low(weth[1].from)===ROUTER&&low(weth[1].to)===POOL&&weth[1].value===wrapped,'WETH settlement');
 const swap=frames.filter(f=>f.node.type==='CALL'&&low(f.node.to)===POOL&&f.node.input.slice(0,10)==='0x128acb08');check(swap.length===1,'one funding swap');
 const [recipient,direction,amount]=ABI.decode(['address','bool','int256','uint160','bytes'],'0x'+swap[0].node.input.slice(10));check(low(recipient)===ROUTER&&direction===true&&amount===wrapped,'funding input');
 const [inputDelta,outputDelta]=ABI.decode(['int256','int256'],swap[0].node.output);check(inputDelta===wrapped&&outputDelta===-BigInt(event.quoteInRaw),'funding output');
 check(logs.get(observed.transfers[0].logIndex)?.path.startsWith(swap[0].path+'.'),'quote outside funding');
 return {payer:sender,recipient:sender,grossQuoteRaw:event.quoteInRaw};
}
module.exports={ROUTER,ACCOUNT,decode,verify};
