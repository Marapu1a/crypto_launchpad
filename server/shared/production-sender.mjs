import { Contract } from 'ethers';
import { digest } from '../../src/tickets/digest.mjs';
import { verifyProductionBindings, policyIdentity } from '../../src/worker/production-policy.mjs';
import { advanceProductionTransaction } from '../../src/worker/production-journal.mjs';
import { inProject, verifyRole } from './store.mjs';

const check = (v, m) => { if (!v) throw Error(m); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const decode = (text, hash) => { const v = JSON.parse(text); check(digest(v) === hash, 'Production DB checksum mismatch'); return v; };
async function binding(c, p, m, policy) {
  const { rows: [row] } = await c.query('SELECT p.chain_id::text,m.program_address FROM launchpad.projects p JOIN launchpad.module_instances m ON m.project_id=p.id WHERE p.id=$1 AND m.id=$2', [p, m]);
  check(row?.chain_id === '4663' && policy.projectId === p && same(row.program_address, policy.contracts.program?.address), 'Production project binding mismatch');
}

// Provision only a new program, never silently adopt active contracts or QIANQI state.
export async function registerProductionSender({ pool, provider, projectId, moduleId, policy }) {
  await verifyRole(pool, 'lp_executor'); await verifyProductionBindings(provider, policy);
  const program = new Contract(policy.contracts.program.address, ['function cycle() view returns(uint256)', 'function pending() view returns(bool)', 'function operator() view returns(address)'], provider);
  check(await program.cycle() === 0n && !await program.pending() && same(await program.operator(), policy.executor), 'New program/executor required');
  return inProject(pool, projectId, async c => {
    await binding(c, projectId, moduleId, policy);
    const state = { schema: 'short-production-journal-v1', identity: policyIdentity(policy), history: [] };
    await c.query('INSERT INTO launchpad.production_senders(project_id,module_id,chain_id,sender,policy_text,policy_hash,state_text,state_hash) VALUES($1,$2,4663,$3,$4,$5,$6,$7)', [projectId, moduleId, policy.executor.toLowerCase(), JSON.stringify(policy), digest(policy), JSON.stringify(state), digest(state)]);
  }, { readOnly: false });
}

// Internal transport. The caller supplies a concrete contract/dataset admission planner.
// No HTTP route or service unit enables it. Session lock lasts across committed writes.
export async function runProductionSender({ pool, provider, signer, projectId, moduleId, request, action, admit, hook }) {
  await verifyRole(pool, 'lp_executor');
  const c = await pool.connect(); let broken = false, held = false, lock;
  const onError = () => { broken = true; }; c.on('error', onError);
  try {
    await c.query("SELECT set_config('launchpad.project_id',$1,false)", [projectId]);
    const { rows: [row] } = await c.query('SELECT * FROM launchpad.production_senders WHERE project_id=$1 AND module_id=$2', [projectId, moduleId]);
    check(row, 'Production sender missing'); const policy = decode(row.policy_text, row.policy_hash);
    check(row.chain_id === '4663' && same(row.sender, policy.executor) && same(await signer.getAddress(), policy.executor), 'Production sender identity mismatch');
    lock = 'production-sender:4663:' + row.sender;
    held = (await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,49177)) AS held', [lock])).rows[0].held;
    if (!held) return { status: 'busy' };
    // Reload AFTER obtaining the lease: a competing writer may have committed meanwhile.
    const { rows: [current] } = await c.query('SELECT * FROM launchpad.production_senders WHERE project_id=$1 AND module_id=$2', [projectId, moduleId]);
    check(current.policy_hash === row.policy_hash, 'Production policy changed');
    const state = decode(current.state_text, current.state_hash); let revision = current.revision;
    const lease = async () => {
      check(!broken, 'Production DB session lost'); await c.query('SELECT 1');
      await binding(c, projectId, moduleId, policy);
      const { rows: [fresh] } = await c.query('SELECT revision,policy_hash FROM launchpad.production_senders WHERE project_id=$1 AND module_id=$2', [projectId, moduleId]);
      check(fresh?.revision === revision && fresh.policy_hash === row.policy_hash, 'Production state changed outside lease');
    };
    const save = async value => {
      await lease();
      const { rows } = await c.query('UPDATE launchpad.production_senders SET state_text=$4,state_hash=$5,revision=revision+1 WHERE project_id=$1 AND module_id=$2 AND revision=$3 RETURNING revision', [projectId, moduleId, revision, JSON.stringify(value), digest(value)]);
      check(rows.length === 1, 'Production state transition lost'); revision = rows[0].revision;
    };
    return await advanceProductionTransaction({ provider, signer, policy, state, save, lease, admit, request, action, hook });
  } finally {
    try { if (held) await c.query('SELECT pg_advisory_unlock(hashtextextended($1,49177))', [lock]); await c.query('RESET launchpad.project_id'); } catch { broken = true; }
    c.removeListener('error', onError); c.release(broken);
  }
}
