import {recognizeProduction,captureBatchContext as capture} from './production-recognition.mjs';
import {ROUTE_PROFILE,isRouterCandidate,captureRouterContext,recognizeRouter} from './draw-router.mjs';
import pins from '../qianqi/routes/genesis-fields.json' with {type:'json'};
// The compatibility view is used only by the pure route decoder, never for policy/journal hashes.
const routeView=p=>({...p,contracts:{...p.contracts,program:p.contracts.fundingRouter,...(p.routes===ROUTE_PROFILE?{batchExecutor:{address:pins.pins.batchExecutor[0],codeHash:pins.pins.batchExecutor[1]}}:{})}});
export function recognizeDraw(p,tx,receipt,context){
 const view=routeView(p),ordinary=recognizeProduction(view,tx,receipt,context);
 return isRouterCandidate(p,tx,receipt)?recognizeRouter(view,tx,receipt,context,ordinary):ordinary;
}
export async function captureBatchContext(provider,p,block,tx,receipt){
 if(receipt&&isRouterCandidate(p,tx,receipt))return captureRouterContext(provider,p,block,tx,receipt);
 if(receipt&&!receipt.logs.some(l=>String(l.address).toLowerCase()===p.contracts.curve.address.toLowerCase()))return;
 return capture(provider,routeView(p),block,tx);
}
