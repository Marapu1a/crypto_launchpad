import { readFile } from 'node:fs/promises';
import { providerFor } from '../src/pons/client.mjs';
import { scanTickets, freezeTicketSnapshot } from '../src/tickets/scanner.mjs';
// Local-only, one durable batch. Profile creation is provided by createProfile().
const [profilePath,statePath,cutoffText,label,bundleDirectory]=process.argv.slice(2);
if(!profilePath||!statePath||!/^\d+$/.test(cutoffText??''))throw Error('Usage: node scripts/index-tickets.mjs profile.json state.json cutoffBlock [snapshotLabel or -] [bundleDirectory]');
const provider=providerFor('http://127.0.0.1:8545');
try{
  const profile=JSON.parse(await readFile(profilePath,'utf8'));
  const state=await scanTickets(provider,profile,statePath,Number(cutoffText),{bundleDirectory});
  console.log(JSON.stringify({head:state.head,wallets:state.wallets}));
  if(label&&label!=='-')console.log(JSON.stringify(await freezeTicketSnapshot(provider,profile,statePath,label,Number(cutoffText)),null,2));
}catch(error){console.error(String(error.shortMessage||error.message).replace(/https?:\/\/\S+/g,'[endpoint]'));process.exitCode=1;}
finally{provider.destroy();}
