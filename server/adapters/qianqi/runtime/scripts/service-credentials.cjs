// systemd credentials stay out of argv and inherited environment.
const fs=require('node:fs'),path=require('node:path');
function readCredential(name,env=process.env){
 if(!env.CREDENTIALS_DIRECTORY||!path.isAbsolute(env.CREDENTIALS_DIRECTORY))throw Error('Credentials directory required');
 if(!['rpc-url','executor-password','executor-keystore'].includes(name))throw Error('Unknown credential');
 const value=fs.readFileSync(path.join(env.CREDENTIALS_DIRECTORY,name),'utf8').trim();
 if(!value)throw Error('Empty credential');
 return value;
}
function rpc(env=process.env){
 const value=readCredential('rpc-url',env),url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('HTTPS RPC required');
 return value;
}
module.exports={readCredential,rpc};
