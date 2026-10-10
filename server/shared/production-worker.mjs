import { digest } from '../../src/tickets/digest.mjs';
import { bundleHash } from '../../src/tickets/late-recognition.mjs';
import { newLedger, scanProductionLedger, creditedPurchases, makeBundle, verifiedCandidate, snapshotProductionTickets } from '../../src/tickets/production-ledger.mjs';
import { verifyTemplate, contracts, check, same } from '../../src/worker/production-template.mjs';
import { finalizedObservation, admitFinalizedSnapshot, policyIdentity } from '../../src/worker/production-policy.mjs';
import { advanceProductionTransaction } from '../../src/worker/production-journal.mjs';
import { admitBeacon } from '../../src/worker/production-timing.mjs';
import { fetchBeacon, fetchLatest, validateBeacon, GENESIS, PERIOD } from '../../src/randomness/drand.mjs';
import { runProductionSender } from './production-sender.mjs';

const wait = reason => { throw Object.assign(Error(reason), { code: 'PRODUCTION_WAIT' }); };
const json = v => JSON.parse(JSON.stringify(v,(_,x) => typeof x === 'bigint' ? String(x) : x));

// Internal, new-template-only runner. No public route/service enables financial sending.
// Both journals and planner/ledger share one session lease and one CAS revision.
export async function runProductionWorker({ pool, provider, signer, publisher, projectId, moduleId,
  getBeacon = fetchBeacon, getLatestBeacon = fetchLatest, now = () => Math.floor(Date.now()/1000), hook }) {
  try {
    return await runProductionSender({ pool, provider, signer, projectId, moduleId, operate: async ({ policy, state, save, lease }) => {
      check(same(await publisher.getAddress(),policy.publisher), 'Wrong recognition publisher');
      const latestContracts = await verifyTemplate(provider,policy), t = policy.template;
      let readBlock = 'latest';
      // Financial decisions use one finalized state, even if a permissionless caller
      // has already mined a newer fund/proof/settle. Explicit BLS block tags stay explicit.
      const c = contracts({ call: request => provider.call({ ...request, blockTag: request.blockTag ?? readBlock }) },policy);
      if (!state.runtime) {
        check(await c.program.cycle() === 0n && !state.pending && state.history.length === 0, 'Active program requires runtime history');
        state.runtime = { schema: 'production-runtime-v1', ledger: newLedger(policy), cycles: {}, sequence: 0, lane: 0,
          publisher: { schema: 'short-production-journal-v1', identity: policyIdentity(policy) + ':publisher', history: [] } };
        await save(state);
      }
      const r = state.runtime, persist = () => save(state);
      check(r.schema === 'production-runtime-v1', 'Wrong runtime schema');
      if (state.failure || r.publisher.failure) return { status: 'blocked', reason: 'reverted-transaction' };
      const observe = async () => {
        const o = await finalizedObservation(provider,now());
        for (const journal of [state,r.publisher]) {
          const last = journal.history.at(-1);
          if (!last) continue;
          check(same((await provider.getBlock(last.blockNumber))?.hash,last.blockHash), 'Finalized sender history changed');
          if (last.blockNumber > o.finalized.number) wait('finality-regression');
        }
        const admitted = await admitFinalizedSnapshot({ provider, policy, snapshot: r.ledger.head, now: o.now });
        if (admitted.status !== 'observed') wait(admitted.reason);
        readBlock = o.finalized.number;
        return o;
      };
      const verifyDraw = async cycle => {
        const s = r.cycles[cycle]; check(s, 'Missing frozen snapshot');
        const d = await c.program.draws(cycle), cp = await c.program.checkpoints(cycle);
        check(same(d.participantsHash,s.participantsHash) && d.budget === BigInt(s.budget)
          && same(cp.ledgerHash,s.checkpoint.ledgerHash) && same(cp.blockHash,s.checkpoint.blockHash)
          && cp.number === BigInt(s.checkpoint.number) && cp.timestamp === BigInt(s.checkpoint.timestamp), 'Frozen snapshot mismatch');
        check(same((await provider.getBlock(s.checkpoint.number))?.hash,s.checkpoint.blockHash), 'Frozen branch changed');
        return d;
      };
      const checkBeacon = async () => {
        let beacon; try { beacon = await getLatestBeacon(); } catch { wait('latest-beacon-unavailable'); }
        const result = await admitBeacon({ observation: await observe(), timing: policy.timing, beacon,
          verify: (round,signature,blockTag) => c.adapter.verify(round,signature,{blockTag}) });
        if (result.status !== 'observed') wait(result.reasons.join(','));
      };
      const admit = async ({ action, request }) => {
        await lease(); await verifyTemplate(provider,policy);
        const op = r.operation;
        check(op && op.action === action && same(request.to,op.request.to) && same(request.data,op.request.data) && String(request.value) === '0', 'Unplanned transaction');
        const encoded = c[op.kind].interface.encodeFunctionData(op.method,op.args);
        check(same(encoded,request.data) && same(c[op.kind].target,request.to), 'Operation calldata mismatch');
        const observation = await observe();
        if (op.method === 'confirm') {
          check(op.role === 'publisher' && op.kind === 'recognition', 'Publisher role mismatch');
          const bundle = r.ledger.bundles[op.args[0]];
          check(bundle && bundleHash(bundle) === op.args[0] && bundle.policyHash === digest(policy) && bundle.candidates.length === Number(op.args[1]), 'Unbound recognition bundle');
          for (const id of bundle.candidates) {
            const event = verifiedCandidate(policy,r.ledger,id);
            check(event.blockNumber <= observation.finalized.number && same((await provider.getBlock(event.blockNumber))?.hash,event.blockHash), 'Purchase not finalized');
          }
          if (observation.finalized.timestamp < Number(await c.recognition.availableAt())) wait('recognition-finality');
          check(!await c.recognition.confirmed(op.args[0]), 'Unjournaled recognition confirmation');
        } else {
          check(op.role === 'executor', 'Executor role mismatch');
          if (op.method === 'freeze') {
            const s = r.cycles[op.cycle];
            check(s && !await c.program.pending() && await c.program.cycle() + 1n === BigInt(op.cycle), 'Freeze cycle mismatch');
            const cutoff = { number:s.checkpoint.number, hash:s.checkpoint.blockHash, timestamp:s.checkpoint.timestamp };
            const snapshot = await snapshotProductionTickets(policy,r.ledger,c.program,cutoff);
            check(digest(snapshot) === digest({ participants:s.participants, participantsHash:s.participantsHash, checkpoint:s.checkpoint }), 'Freeze dataset changed');
            check(await c.program.freeFund() === BigInt(s.budget) && await latestContracts.program.freeFund() === BigInt(s.budget), 'Freeze budget changed');
            if (observation.finalized.timestamp < Number(await c.program.lastTerminal() + await c.program.interval())) wait('interval-finality');
            await checkBeacon();
          } else if (['prove','deliver'].includes(op.method) && op.kind === 'adapter') {
            const d = await verifyDraw(op.cycle), requestId = await c.program.requestForCycle(op.cycle), rng = await c.adapter.requests(requestId);
            check(String(requestId) === String(op.args[0]) && same(rng.consumer,c.program.target) && same(rng.context,d.context), 'RNG request mismatch');
            if (op.method === 'prove') {
              if (observation.finalized.timestamp < GENESIS+(Number(rng.round)-1)*PERIOD) wait('beacon-time-finality');
              check(await c.adapter.verify(rng.round,op.args[1]), 'Invalid BLS proof');
            } else check(rng.proven, 'RNG not proven');
          } else if (op.method === 'settle' || op.method === 'claim') await verifyDraw(op.cycle);
          else check((op.kind === 'collector' && ['sweepCurve','collect','forward'].includes(op.method)) || (op.kind === 'splitter' && op.method === 'deliver'), 'Unsupported executor operation');
        }
      };
      const execute = async () => {
        const op = r.operation; check(op, 'Missing durable operation');
        const journal = op.role === 'publisher' ? r.publisher : state;
        const result = await advanceProductionTransaction({ provider, signer: op.role === 'publisher' ? publisher : signer, policy, state: journal,
          role: op.role, save: persist, lease, admit, request:op.request, action:op.action, hook });
        if (['confirmed','already-confirmed'].includes(result.status)) { delete r.operation; await persist(); }
        return { ...result, operation:op.kind+'.'+op.method, role:op.role };
      };
      if (r.operation) return execute();
      check(!state.pending && !r.publisher.pending, 'Journal missing planner intent');
      const observation = await observe();
      const caughtUp = await scanProductionLedger(provider,policy,r.ledger,observation.finalized);
      await persist();
      if (!caughtUp) return {status:'waiting',reason:'index-catchup',head:r.ledger.head.number};
      const cycle = String(await c.program.cycle()), pending = await c.program.pending();
      if (cycle !== '0') await verifyDraw(cycle);
      const plan = (kind,method,args=[],extra={}) => ({role:'executor',kind,method,args:json(args),...extra});
      const recognitionPlan = async () => {
        if (observation.finalized.timestamp < Number(await c.recognition.availableAt())) return;
        const used = new Set(creditedPurchases(policy,r.ledger).map(e => e.candidateId));
        const ids = r.ledger.events.filter(e => e.status === 'ELIGIBLE' && !used.has(e.candidateId)).slice(0,50).map(e => e.candidateId);
        if (!ids.length) return;
        const bundle = makeBundle(policy,ids), hash = bundleHash(bundle);
        r.ledger.bundles[hash] = bundle;
        return plan('recognition','confirm',[hash,ids.length],{role:'publisher'});
      };
      const feePlan = async () => {
        for (let lane = 0; lane < 3; lane++) if (await c.splitter.credit(lane) > 0n) return plan('splitter','deliver',[lane]);
        if (await c.quote.balanceOf(c.collector.target) > 0n) return plan('collector','forward');
        if (await c.escrow.balanceOfToken(c.collector.target,c.quote.target) > 0n) return plan('collector','collect');
        if (!await c.curve.graduated() && (await c.curve.quoteFeeBalance() > 0n || await c.curve.creatorTaxBalance() > 0n)) return plan('collector','sweepCurve');
      };
      let waiting = 'conditions';
      const drawPlan = async () => {
        for (const id of Object.keys(r.cycles)) {
          if (BigInt(id) > BigInt(cycle)) continue;
          const d = await verifyDraw(id);
          if (d.settled) for (const person of r.cycles[id].participants)
            if (await c.program.rewards(id,person.wallet) > 0n) return plan('program','claim',[id,person.wallet],{cycle:id});
        }
        if (pending) {
          const requestId = await c.program.requestForCycle(cycle), rng = await c.adapter.requests(requestId);
          if (!rng.proven) {
            if (observation.finalized.timestamp < GENESIS+(Number(rng.round)-1)*PERIOD) { waiting = 'beacon-time-finality'; return; }
            let beacon; try { beacon = await getBeacon(Number(rng.round)); } catch { waiting = 'beacon-unavailable'; return; }
            return plan('adapter','prove',[requestId,validateBeacon(beacon,Number(rng.round))],{cycle});
          }
          if (!rng.delivered) return plan('adapter','deliver',[requestId],{cycle});
          return plan('program','settle',[r.cycles[cycle].participants],{cycle});
        }
        const budget = await c.program.freeFund();
        if (observation.finalized.timestamp < Number(await c.program.lastTerminal()+await c.program.interval()) || budget < BigInt(t.minimumFund)
          || budget / t.weights.reduce((a,b) => a+BigInt(b),0n) < BigInt(t.minimumUnit)) return;
        const next = String(BigInt(cycle)+1n);
        let s = r.cycles[next];
        if (!s) {
          s = await snapshotProductionTickets(policy,r.ledger,c.program);
          if (!s.participants.length) { waiting = 'participants'; return; }
          try { await checkBeacon(); } catch(e) { if(e.code === 'PRODUCTION_WAIT') {waiting=e.message;return;} throw e; }
          s.budget = String(budget); r.cycles[next] = s;
        }
        return plan('program','freeze',[s.participants,s.checkpoint],{cycle:next});
      };
      // Round-robin lanes: continuous new buys/fees cannot starve a due draw or recognition.
      const planners = [feePlan,recognitionPlan,drawPlan];
      for (let i = 0; i < planners.length; i++) {
        const lane = (r.lane+i)%planners.length, op = await planners[lane]();
        if (!op) continue;
        op.action = 'runtime:' + (++r.sequence) + ':' + op.kind + '.' + op.method;
        op.request = {to:c[op.kind].target.toLowerCase(),data:c[op.kind].interface.encodeFunctionData(op.method,op.args),value:'0'};
        r.operation = op; r.lane = (lane+1)%planners.length;
        await persist(); return execute();
      }
      return {status:'waiting',reason:waiting,cycle};
    } });
  } catch(e) {
    if (['PRODUCTION_WAIT','FINALITY_WAIT'].includes(e.code)) return {status:'waiting',reason:e.message};
    throw e;
  }
}

// One failed project must not prevent another project's pass. No raw RPC errors/secrets in status.
export async function runProductionProjects(projects) {
  const results = [];
  for (const project of projects) {
    try { results.push({projectId:project.projectId,...await runProductionWorker(project)}); }
    catch { results.push({projectId:project.projectId,status:'blocked',reason:'project-pass-failed'}); }
  }
  return results;
}
