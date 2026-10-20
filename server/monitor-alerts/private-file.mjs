import {readFile,lstat,realpath} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {privateCredentialMode} from '../shared/credential-access.mjs';
// Web/bot credentials do not require loading the financial runtime configuration.
export async function privateText(file){
 if(typeof file!=='string'||!isAbsolute(file))throw Error('Absolute credential path required');
 const stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0||stat.size>65536)throw Error('Invalid credential file');
 if(process.platform!=='win32'){
  const directory=process.env.CREDENTIALS_DIRECTORY;
  if(!privateCredentialMode({file,stat,directory,realDirectory:directory?await realpath(directory):undefined,gid:process.getgid()}))throw Error('Credential file must be private');
 }
 return (await readFile(file,'utf8')).trim();
}
