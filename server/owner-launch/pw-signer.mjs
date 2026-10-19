import {privateText} from '../short-runtime/config.mjs';
import {loadExecutorKeystore} from '../../src/worker/executor-keystore.mjs';

// Reuse the encrypted-keystore loader. No provider is attached to this wallet:
// its only responsibility is signing; durable coordinator owns broadcasting.
export async function loadPwOwnerSigner(config){
 if(config.allowPublicTransactions!==true||!config.ownerKeystore)return undefined;
 const {file,passwordFile}=config.ownerKeystore;
 await privateText(file); // absolute, regular, private credential file
 return loadExecutorKeystore({file,password:await privateText(passwordFile),expectedAddress:config.profile.owner});
}
