import pg from 'pg';
import { migrate } from '../db/migrate.mjs';

if(!process.env.SHARED_MIGRATION_URL)throw Error('SHARED_MIGRATION_URL required; use a dedicated database with bootstrap roles');
const client=new pg.Client({connectionString:process.env.SHARED_MIGRATION_URL});
try{await client.connect();await migrate(client);console.log('Shared schema migration complete');}
catch{console.error('Shared schema migration failed; inspect database state/roles and migration version');process.exitCode=1;}
finally{await client.end();}
