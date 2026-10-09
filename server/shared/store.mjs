import pg from 'pg';

export function createPool(connectionString) {
  const pool=new pg.Pool({connectionString,max:4,connectionTimeoutMillis:3000,idleTimeoutMillis:10000});
  pool.on('error',()=>{}); // Requests surface failure; never print credentials from connection errors.
  return pool;
}
export async function verifyRole(pool,expected) {
  const {rows:[role]}=await pool.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  if(role.name!==expected||role.rolsuper||role.rolbypassrls)throw Error('Unexpected database runtime role');
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function inProject(pool,projectId,work,{readOnly=true}={}) {
  if(!uuid.test(projectId))throw Error('Invalid internal project identity');
  const client=await pool.connect();let failed=false;
  try{
    await client.query(readOnly?'BEGIN READ ONLY':'BEGIN');
    await client.query("SELECT set_config('launchpad.project_id',$1,true)",[projectId]);
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    const result=await work(client);
    await client.query('COMMIT');return result;
  }catch(error){try{await client.query('ROLLBACK');}catch{failed=true;}throw error;}
  finally{client.release(failed);}
}
export async function readProject(pool,projectId) {
  return inProject(pool,projectId,async client=>{
    const {rows:[project]}=await client.query('SELECT id,slug,display_name,chain_id::text,token_address,status FROM launchpad.projects WHERE id=$1',[projectId]);
    if(!project)return null;
    const {rows:modules}=await client.query(`SELECT m.id,m.kind,m.adapter_version,m.program_address,m.config_hash,
      c.block_number::text,c.block_hash FROM launchpad.module_instances m
      LEFT JOIN launchpad.project_cursors c ON c.project_id=m.project_id AND c.module_id=m.id
      WHERE m.project_id=$1 ORDER BY m.id`,[projectId]);
    return {project,modules};
  });
}

// Internal read-model jobs only. No signing, claims or financial tasks in this skeleton.
export async function claimViewJob(pool,projectId) {
  return inProject(pool,projectId,async client=>{
    const {rows}=await client.query(`WITH candidate AS (
      SELECT project_id,id FROM launchpad.jobs WHERE project_id=$1 AND status='queued'
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE launchpad.jobs j SET status='running' FROM candidate c
      WHERE j.project_id=c.project_id AND j.id=c.id RETURNING j.*`,[projectId]);
    return rows[0]??null;
  },{readOnly:false});
}
