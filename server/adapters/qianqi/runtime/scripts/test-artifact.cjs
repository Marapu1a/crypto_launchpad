const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const PATH='RH_TEST_ARTIFACT',HASH='RH_TEST_ARTIFACT_SHA256',AUDIT='RH_TEST_COMPILE_AUDIT';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function readArtifact(env=process.env){
 if(env[PATH]===undefined&&env[HASH]===undefined)return null;
 if(!env[PATH]||!path.isAbsolute(env[PATH])||!env[HASH]||! /^[a-f0-9]{64}$/.test(env[HASH]))throw Error('Invalid test artifact contract');
 if(!fs.statSync(env[PATH]).isFile())throw Error('Test artifact is not a file');
 const bytes=fs.readFileSync(env[PATH]);if(digest(bytes)!==env[HASH])throw Error('Test artifact digest mismatch');
 const result=JSON.parse(bytes);
 if(!result||Array.isArray(result)||!Object.keys(result).length||Object.values(result).some(a=>!Array.isArray(a?.abi)||typeof a?.evm?.bytecode?.object!=='string'||typeof a?.evm?.deployedBytecode?.object!=='string'))throw Error('Invalid compiled test artifact');
 return result;
}
function audit(kind){if(process.env[AUDIT])fs.appendFileSync(process.env[AUDIT],JSON.stringify({kind,pid:process.pid})+'\n');}
function clearContract(env){const copy={...env};delete copy[PATH];delete copy[HASH];delete copy[AUDIT];return copy;}
module.exports={PATH,HASH,AUDIT,digest,readArtifact,audit,clearContract};
