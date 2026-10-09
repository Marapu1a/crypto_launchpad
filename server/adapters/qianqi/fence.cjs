const {AsyncLocalStorage}=require('node:async_hooks');
const context=new AsyncLocalStorage();
const withFence=(check,action)=>context.run(check,action);
async function checkFence(){const check=context.getStore();if(check)await check();}
module.exports={withFence,checkFence};
