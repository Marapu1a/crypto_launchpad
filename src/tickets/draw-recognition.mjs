import {recognizeProduction,captureBatchContext as capture} from './production-recognition.mjs';
// The compatibility view is used only by the pure route decoder, never for policy/journal hashes.
const routeView=p=>({...p,contracts:{...p.contracts,program:p.contracts.fundingRouter}});
export const recognizeDraw=(p,tx,receipt,context)=>recognizeProduction(routeView(p),tx,receipt,context);
export const captureBatchContext=(provider,p,block,tx)=>capture(provider,routeView(p),block,tx);
