import { readProject } from './store.mjs';

export function hostname(req) {
  if(req.rawHeaders.filter((h,i)=>i%2===0&&h.toLowerCase()==='host').length!==1)return null;
  const value=req.headers.host;
  if(typeof value!=='string'||!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/i.test(value))return null;
  const [host,port]=value.toLowerCase().split(':');
  if(port&&(Number(port)<1||Number(port)>65535))return null;
  if(host.split('.').some(label=>!label||label.length>63||label.startsWith('-')||label.endsWith('-')))return null;
  return host;
}
export function sharedApi(pool,{projectAdapters=new Map()}={}) {
  return async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
    try{
      const host=hostname(req);
      if(!host)return reply(400,{error:'invalid_host'});
      if(req.method!=='GET')return reply(405,{error:'read_only'});
      // Proxy headers are not trusted. Deployment must preserve the validated Host.
      const {rows:[route]}=await pool.query('SELECT launchpad.resolve_host($1) AS id',[host]);
      if(!route?.id)return reply(421,{error:'unknown_project_host'});
      if(req.url?.startsWith('/v1/')){
        const adapter=projectAdapters.get(route.id);
        if(adapter)return await adapter.handle(req,res);
      }
      if(req.url!=='/api/project')return reply(404,{error:'not_found'});
      const result=await readProject(pool,route.id);
      return result?reply(200,result):reply(404,{error:'not_found'});
    }catch{return reply(503,{error:'temporarily_unavailable'});}
  };
}
