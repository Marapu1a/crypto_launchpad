// Read-only CLI. Credentials stay in environment, no wallet is loaded.
async function main(){
 const fs=require('node:fs'),{ethers}=require('ethers'),[configFile,profileFile]=process.argv.slice(2);
 if(process.argv.length!==4)throw Error('Use CONFIG PROFILE');
 const url=new URL(process.env.RH_RPC_URL);if(url.protocol!=='https:'||url.username||url.password)throw Error('HTTPS RPC required');
 const c=JSON.parse(fs.readFileSync(configFile)),p=JSON.parse(fs.readFileSync(profileFile));
 const request=new ethers.FetchRequest(url.href);request.timeout=20000;
 const provider=new ethers.JsonRpcProvider(request,undefined,{cacheTimeout:-1});
 try{const report=await require('./pons-public-profile.cjs').inspect(provider,p,c);console.log(JSON.stringify(report));if(report.status!=='matched')process.exitCode=1;}finally{provider.destroy();}
}
if(require.main===module)main().catch(()=>{console.error('Pons inspection refused: check profile, configuration and RPC access');process.exitCode=1;});
module.exports={main};
