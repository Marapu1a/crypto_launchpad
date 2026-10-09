// Planning inspection only. No signer, RPC, transaction or authorization.
const fs = require('node:fs');
const REQUIRED = {
 contracts: ['token', 'registry', 'vault', 'short', 'monthly', 'adapter', 'collector', 'pairSource', 'buyPolicySource', 'pool', 'quote'],
 roles: ['governor', 'publisherExecutor', 'operations', 'project'],
 launch: ['creator', 'name', 'symbol', 'metadataURI', 'metadataHash', 'openingProfile', 'sniperProtection', 'protectionBlocks', 'userSalt', 'vanityNonce', 'developerBuy', 'launchFeeBudgetWei'],
 unresolved: ['timingApproval', 'shortRules', 'monthlyRules', 'shortWeights', 'minimumUnitRaw', 'maxShortBudgetRaw', 'rulesNoticeSeconds', 'maxGasPrice', 'controllerNativeFloor', 'archiveRpc', 'durableRuntime', 'nativeRefill', 'monthlyWinnerWeight'],
};
const ACCEPTED = {
 'product.monthlyMinimumCurrentRaw': '100000000',
 'unresolved.minimumUnitRaw': '5000000',
 'unresolved.shortWeights.length': 10,
 ...Object.fromEntries([7,4,2,1,1,1,1,1,1,1].map((w,i)=>['unresolved.shortWeights.'+i,w])),
 'unresolved.shortRules.version': 1,
 'unresolved.shortRules.pNumerator': 4,
 'unresolved.shortRules.pDenominator': 5,
 'unresolved.shortRules.hNumerator': 1,
 'unresolved.shortRules.hDenominator': 1,
 'product.shortBudgetMode': 'FREE_SHORT',
 'product.monthlyPayoutNumerator': 3,
 'product.monthlyPayoutDenominator': 4,
 'unresolved.monthlyWinnerWeight': 'ENTRIES_OVER_ENTRIES_PLUS_ONE_Q128',
 'unresolved.monthlyRules.version': 2,
 'unresolved.monthlyRules.pNumerator': 3,
 'unresolved.monthlyRules.pDenominator': 4,
 'unresolved.monthlyRules.hNumerator': 1,
 'unresolved.monthlyRules.hDenominator': 1,
 'unresolved.maxShortBudgetRaw': ((1n << 256n)-1n).toString(),
 'product.creatorFeeBps': 300,
 'product.entryThresholdRaw': '100000000',
 'product.nextStartTargetRaw': '100000000',
 'product.shortInterval': 21600,
 'product.monthlyInterval': 2592000,
 'product.creatorAllocationBps.promo': 9000,
 'product.creatorAllocationBps.operations': 500,
 'product.creatorAllocationBps.project': 500,
};
const get = (p, path) => path.split('.').reduce((v, key) => v?.[key], p);
const absent = value => value == null || value === '';
function inspectPlan(p) {
 if (p?.schema !== 'robinhood-launch-plan-v1' || p.status !== 'incomplete-not-executable' || p.network?.chainId !== 4663 || p.controllers?.cutoffMode !== 'FINALIZED_CHECKPOINT' || p.publicExecutionEnabled !== false) throw Error('Explicit incomplete Robinhood plan required');
 if(!['pons-v2','pair-infinity'].includes(p.integration))throw Error('Explicit launch integration required');
 const pons=p.integration==='pons-v2';
 if(pons&&(p.initialPurchase?.routeVersion!==require('./pons-v4-buy.cjs').ID||'pairSource' in (p.contracts||{})||['openingProfile','sniperProtection','protectionBlocks','vanityNonce','userSalt'].some(k=>k in (p.launch||{}))))throw Error('Pons plan contains incompatible launch route/settings');
 if(!pons&&p.initialPurchase?.routeVersion!=='rh-infinity-exact-input-v1')throw Error('PAIR reserve route required');
 const required=pons?{...REQUIRED,contracts:['token','registry','vault','short','monthly','adapter','collector','buyPolicySource','quote','factory','curve','hook','escrow','poolId','router','manager','permit2'],launch:['creator','name','symbol','metadataURI','metadataHash','launchFeeBudgetWei','creatorFeeRecipient','launchParameters','developerBuy']}:REQUIRED;
 const settings = Object.entries(required).flatMap(([section, names]) => names.map(name => {
  const path = section + '.' + name;
  const category = section === 'contracts' ? 'deployment-derived' : section === 'launch' && ['metadataHash','userSalt','vanityNonce'].includes(name) ? 'deployment-derived' : section === 'roles' || section === 'launch' ? 'owner-choice' : ['archiveRpc', 'durableRuntime', 'nativeRefill'].includes(name) ? 'operational-qualification' : 'owner-choice';
  return {path, category, status: absent(get(p, path)) ? 'missing' : 'provided-not-verified'};
 }));
 const accepted = Object.entries(ACCEPTED).map(([path, expected]) => ({path, expected, matches: get(p, path) === expected}));
 return {
  schema: p.schema,
  integration:p.integration,
  missing: settings.filter(row => row.status === 'missing').map(row => row.path),
  accepted, conflicts: accepted.filter(row => !row.matches).map(row => row.path), settings,
  timing: {status: 'candidate-not-qualified', candidate: p.timingCandidate ?? null, approvalPresent: !absent(p.unresolved?.timingApproval)},
  requiredEvidence: ['pinned-deployment-admission', 'rpc-history-and-repeatable-buy-replay', 'production-timing-observations-and-approval', 'durable-service-and-key-custody', 'same-chain-automatic-cycle'],
  publicLaunchReady: false, executable: false,
  reason: 'Provided values are not verified. Complete the pinned deployment profile and independent qualification; this report never authorizes execution',
 };
}
if (require.main === module) {
 try { console.log(JSON.stringify(inspectPlan(JSON.parse(fs.readFileSync(process.argv[2] || 'config/robinhood-launch-plan.json', 'utf8'))), null, 2)); }
 catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = {inspectPlan};
