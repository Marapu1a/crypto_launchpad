const {AsyncLocalStorage}=require('node:async_hooks');
const context=new AsyncLocalStorage();
let mandatory=false;
// One-way process policy: detached callbacks must not silently lose the lease.
const requireFence=()=>{mandatory=true;};
const withFence=(check,action)=>{
 if(typeof check!=='function')throw Error('QIANQI executor fence required');
 return context.run(check,action);
};
async function checkFence({required=false}={}){
 const check=context.getStore();
 if(!check){if(mandatory||required)throw Error('QIANQI executor fence missing');return;}
 await check();
}
module.exports={withFence,checkFence,requireFence};
