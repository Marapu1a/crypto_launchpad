import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function migrate(client) {
  const sql=await readFile(new URL('./migrations/001_projects.sql',import.meta.url),'utf8');
  const checksum=createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex');
  await client.query('BEGIN');
  try{
    await client.query('SELECT pg_advisory_xact_lock(49172,1)');
    const {rows:[found]}=await client.query("SELECT to_regclass('launchpad.schema_migrations') AS table_name");
    if(found.table_name){
      const {rows:[record]}=await client.query('SELECT checksum FROM launchpad.schema_migrations WHERE version=1');
      if(record?.checksum!==checksum)throw Error('Migration checksum/version mismatch');
    }else{
      await client.query(sql);
      await client.query('INSERT INTO launchpad.schema_migrations(version,checksum) VALUES(1,$1)',[checksum]);
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
}
