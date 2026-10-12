import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {loadCatalog} from '../server/project-bot/catalog.mjs';
import {menu,card,contract,search} from '../server/project-bot/replies.mjs';
const catalog=await loadCatalog();
const html=await readFile(new URL('../server/project-bot/preview.html',import.meta.url));
createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
 if(url.pathname==='/api/preview'){
  res.setHeader('Content-Type','application/json');const action=url.searchParams.get('action')??'menu',[kind,id]=action.split(':');
  return res.end(JSON.stringify(url.searchParams.has('q')?search(catalog,url.searchParams.get('q')):kind==='contract'?contract(catalog,id):kind==='project'?card(catalog,id):menu(catalog)));
 }
 res.writeHead(404);res.end();
}).listen(4198,'127.0.0.1',()=>console.log('Bot preview http://127.0.0.1:4198/ — no Telegram connection'));
