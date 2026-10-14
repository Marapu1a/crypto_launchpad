import {posix} from 'node:path';
const {dirname,resolve}=posix;
// systemd LoadCredential exposes root-owned 0440 files via a service-group or
// user ACL. Ordinary files remain owner-only; never accept group-writable data.
export function privateCredentialMode({file,stat,directory,realDirectory,gid}){
 if((stat.mode&0o077)===0)return true;
 return typeof directory==='string'&&directory.startsWith('/run/credentials/')&&
  resolve(directory)===directory&&realDirectory===directory&&dirname(file)===directory&&
  stat.uid===0&&(stat.gid===0||stat.gid===gid)&&(stat.mode&0o777)===0o440;
}
