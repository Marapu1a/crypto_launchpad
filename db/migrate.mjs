import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function migrate(client) {
  await client.query('BEGIN');
  try{
    await client.query('SELECT pg_advisory_xact_lock(49172,1)');
    const {rows:[found]}=await client.query("SELECT to_regclass('launchpad.schema_migrations') AS table_name");
    const files=['001_projects.sql','002_chain_read.sql','003_ticket_shadow.sql','004_ticket_ledger.sql','005_financial_journal.sql','006_postgres_worker.sql','007_qianqi_history.sql','008_qianqi_live.sql','009_qianqi_live_bodies.sql','010_existing_qianqi.sql','011_production_senders.sql','012_production_wallets.sql'];
    const records=found.table_name?(await client.query('SELECT version,checksum FROM launchpad.schema_migrations ORDER BY version')).rows:[];
    if(records.some((r,i)=>r.version!==i+1)||records.length>files.length)throw Error('Migration version mismatch');
    for(const [i,file] of files.entries()){
      const sql=await readFile(new URL('./migrations/'+file,import.meta.url),'utf8');
      const checksum=createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex');
      if(records[i]){
        if(records[i].checksum!==checksum)throw Error('Migration checksum mismatch');
      }else{
        await client.query(sql);
        await client.query('INSERT INTO launchpad.schema_migrations(version,checksum) VALUES($1,$2)',[i+1,checksum]);
      }
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
}
