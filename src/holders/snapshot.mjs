import {address,check,identity,uint} from './values.mjs';

// Injected transport only. No built-in polling, RPC or live-source acceptance.
export async function collectHolderSnapshot({chainId,token,fetchPage,maxPages,maxHolders,observedAt}){
 token=address(token);
 check(Number.isSafeInteger(observedAt)&&observedAt>0,'Explicit observation time required');
 check(Number.isInteger(maxPages)&&maxPages>0&&maxPages<=1000,'Invalid page budget');
 check(Number.isInteger(maxHolders)&&maxHolders>0&&maxHolders<=100000,'Invalid holder budget');
 const pages=[],cursors=new Set();let cursor=null;
 for(let n=0;n<maxPages;n++){
  const response=structuredClone(await fetchPage(cursor));pages.push({cursor,response});
  check(Array.isArray(response.page)&&response.page.length<=maxHolders,'Invalid holder page');
  check(pages.reduce((sum,p)=>sum+p.response.page.length,0)<=maxHolders,'Holder budget exceeded');
  const next=response.next_cursor;
  if(next===null)return validateHolderSnapshot({schema:'holder-candidate-v1',chainId,token,observedAt,pages});
  check(typeof next==='string'&&next.length>0&&next.length<=2048&&!cursors.has(next),'Invalid or repeated cursor');
  cursors.add(next);cursor=next;
 }
 throw Error('Incomplete holder snapshot: page budget exhausted');
}

// Count/supply consistency is NOT proof of an atomic snapshot during transfers.
export function validateHolderSnapshot(input){
 check(input?.schema==='holder-candidate-v1','Invalid snapshot schema');
 const token=address(input.token),pages=input.pages;
 check(Number.isSafeInteger(input.chainId)&&input.chainId>0,'Explicit source chain required');
 check(Number.isSafeInteger(input.observedAt)&&input.observedAt>0,'Invalid observation time');
 check(Array.isArray(pages)&&pages.length>0&&pages.length<=1000,'Missing pages');
 const first=pages[0].response;
 check(Number.isSafeInteger(first.holders)&&first.holders>=0&&first.holders<=100000,'Invalid holder count');
 const supply=uint(first.supply);check(first.as_of&&typeof first.as_of==='object'&&!Array.isArray(first.as_of),'Missing source metadata');
 for(const k of ['rollup_bucket','tail_from_block'])check(Number.isSafeInteger(first.as_of[k])&&first.as_of[k]>=0,'Invalid source checkpoint metadata');
 const metadata=identity(first.as_of),seen=new Set(),cursors=new Set(),holders=[];let cursor=null,total=0n;
 for(let i=0;i<pages.length;i++){
  const p=pages[i],r=p.response;
  check(p.cursor===cursor,'Broken page chain');
  check(address(r.token)===token&&r.holders===first.holders&&r.supply===first.supply&&identity(r.as_of)===metadata,'Source changed during pagination');
  check(Array.isArray(r.page)&&holders.length+r.page.length<=100000,'Invalid page');
  for(const row of r.page){
   const wallet=address(row.wallet),balance=uint(row.balance);check(balance>0n&&!seen.has(wallet),'Duplicate or zero-balance holder');
   seen.add(wallet);total+=balance;holders.push({wallet,balance:String(balance)});
  }
  cursor=r.next_cursor;
  if(i<pages.length-1){check(typeof cursor==='string'&&cursor.length>0&&cursor.length<=2048&&!cursors.has(cursor),'Repeated or missing cursor');cursors.add(cursor);}
  else check(cursor===null,'Incomplete holder snapshot');
 }
 check(holders.length===first.holders&&total===supply,'Holder count or supply mismatch');
 holders.sort((a,b)=>a.wallet.localeCompare(b.wallet));
 const source={schema:input.schema,chainId:input.chainId,token,observedAt:input.observedAt,pages:structuredClone(pages)};
 return {...source,id:identity(source),holders,supply:String(supply),atomicity:'unverified'};
}

export function acceptFixtureSnapshot(candidate,{reason}){
 check(typeof reason==='string'&&reason.trim().length>0,'Acceptance reason required');
 const snapshot=validateHolderSnapshot(candidate);
 return {schema:'holder-accepted-fixture-v1',snapshot,acceptance:{mode:'fixture-only',reason}};
}

export function verifyAcceptedSnapshot(accepted){
 check(accepted?.schema==='holder-accepted-fixture-v1'&&accepted.acceptance?.mode==='fixture-only','Only explicit fixture acceptance is supported');
 check(typeof accepted.acceptance.reason==='string'&&accepted.acceptance.reason.trim(),'Missing acceptance reason');
 const valid=validateHolderSnapshot(accepted.snapshot);
 check(identity(valid)===identity(accepted.snapshot),'Snapshot modified after acceptance');return valid;
}
