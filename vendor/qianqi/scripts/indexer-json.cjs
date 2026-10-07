// Index snapshots are plain JSON. Chunk the large block array before serialization;
// retain JSON.stringify semantics and the existing file format.
function* jsonChunks(value,depth=0){
 if(depth>=3||value===null||typeof value!=='object'||typeof value.toJSON==='function'){
  yield JSON.stringify(value);return;
 }
 if(Array.isArray(value)){
  yield '[';
  for(let i=0;i<value.length;i++){if(i)yield ',';if(value[i]===undefined)yield 'null';else yield* jsonChunks(value[i],depth+1);}
  yield ']';
 }else{
  yield '{';let first=true;
  for(const key of Object.keys(value)){
   if(value[key]===undefined||typeof value[key]==='function'||typeof value[key]==='symbol')continue;
   if(!first)yield ',';first=false;yield JSON.stringify(key)+':';yield* jsonChunks(value[key],depth+1);
  }
  yield '}';
 }
}
function writeIndexerJson(fd,value){
 const fs=require('node:fs');let buffer='';
 for(const chunk of jsonChunks(value)){buffer+=chunk;if(buffer.length>=65536){fs.writeFileSync(fd,buffer);buffer='';}}
 fs.writeFileSync(fd,buffer+'\n');
}
module.exports={jsonChunks,writeIndexerJson};
