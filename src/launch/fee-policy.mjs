export const DRAW_FEE_POLICY='draw-prizes-team-operations-v1';
export const PW_FEE_POLICY='pw-holders-draw-project-v1';
// A policy is a deployment graph, never a label inferred from the token name.
export function assertDrawFeePolicy(input={},profile={}){
 for(const value of [input.feePolicyKind,profile.feePolicyKind]){
  if(value===PW_FEE_POLICY)throw Error('PW holder launches disabled: production admission and role recovery pending; use isolated local rehearsal');
  if(value!==undefined&&value!==DRAW_FEE_POLICY)throw Error('Unsupported fee policy');
 }
 if(input.schema==='pattern-watcher-preparation-v1')throw Error('PW preparation is not executable');
 if(profile.mode==='production'&&input.draws?.asset==='ETH'&&profile.feePolicyKind!==DRAW_FEE_POLICY)
  throw Error('Production ETH requires an explicit pinned feePolicyKind');
}
