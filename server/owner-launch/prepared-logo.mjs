import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';

// Operator-selected project asset only. HTTP callers cannot choose a file path.
export async function loadPreparedLogo(asset,expectedUri,root=process.cwd()){
 if(!asset||typeof asset.path!=='string'||!/^tokens\/[\w-]+\/[\w .()-]+\.(png|jpe?g|webp)$/i.test(asset.path)||asset.uri!==expectedUri||!/^ipfs:\/\//.test(asset.uri)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('Invalid prepared logo');
 const tokensRoot=await realpath(resolve(root,'tokens'));
 const file=await realpath(resolve(root,asset.path));
 if(!file.startsWith(tokensRoot+sep))throw Error('Logo outside project assets');
 const bytes=await readFile(file);
 if(bytes.length>10*1024*1024||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('Prepared logo changed');
 const mime=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 if(!mime)throw Error('Unsupported prepared logo');
 return {path:asset.path,uri:asset.uri,bytes,mime};
}
