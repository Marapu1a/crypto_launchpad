import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
export const demoAddress='0x'+'1'.repeat(40);
export function demoModule(){return {id:'demo:short',observedAt:new Date().toISOString(),stale:false,service:{status:'waiting',stale:false},snapshot:{kind:'short',cycle:'3',settings:{asset:'USDG',decimals:6,thresholdRaw:'10000000'},fundRaw:'50123456',pendingRecognition:{count:1,items:[{transactionHash:'0x'+'a'.repeat(64),blockNumber:123,status:'awaiting-recognition'}]},wallet:{eligibleVolumeRaw:'122500000',totalIssued:'12',used:'8',reserved:'3',available:'1',remainderRaw:'2500000',latestCycle:'3',latestUnpaidRewardRaw:'0'}}};}
export function demoServer({auto=false}={}){return createServer(async(req,res)=>{
 try{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name.startsWith('/api/')){res.setHeader('Content-Type','application/json');
   if(name==='/api/project')return res.end(JSON.stringify({project:{slug:'igw',chain_id:4663,token_address:'0x'+'9'.repeat(40)}}));
   if(name==='/api/draws')return res.end(JSON.stringify({modules:[demoModule()]}));
   const match=/^\/api\/wallet\/(0x[0-9a-f]{40})$/i.exec(name);
   if(match)return res.end(JSON.stringify({address:match[1].toLowerCase(),modules:[demoModule()]}));
   res.writeHead(404);return res.end('{}');
  }
  const base=path.resolve('tokens/IGW/site'),file=path.resolve(base,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(base+path.sep))throw Error();
  const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png'}[path.extname(file)]??'application/octet-stream';res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');
  let content=await fs.readFile(file);
  if(file.endsWith('.html'))content=content.toString().replace('<body>','<body><div style="padding:14px;background:#ffc74b;color:#181813;text-align:center;font:14px sans-serif">LOCAL PREVIEW · Simulated data. No deployed IGW token or real tickets.</div>');
  if(auto&&file.endsWith('.html'))content=content.replace('</body>',`<script>document.addEventListener('igw-project',function preview(e){if(!e.detail)return;document.removeEventListener('igw-project',preview);const input=document.querySelector('#wallet-address');input.value='${demoAddress}';document.querySelector('#wallet-form').requestSubmit();});</script></body>`);
  res.end(content);
 }catch{res.writeHead(404);res.end();}
});}
