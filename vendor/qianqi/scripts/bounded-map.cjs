// Drain already-started work before returning an error; never leave RPC writers
// running after a caller releases its state lock.
async function mapLimit(values, limit, fn) {
 const out=new Array(values.length);let next=0,error,failed=false;
 await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{
  while(!failed){const i=next++;if(i>=values.length)return;try{out[i]=await fn(values[i],i);}catch(e){if(!failed){failed=true;error=e;}}}
 }));
 if(failed)throw error;return out;
}
module.exports={mapLimit};
