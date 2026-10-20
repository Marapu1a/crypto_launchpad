import {readFile} from 'node:fs/promises';
import {privateText} from '../server/monitor-alerts/private-file.mjs';
import {createPool} from '../server/shared/store.mjs';
const config=JSON.parse(await privateText(process.argv[2]));
const pool=createPool(await privateText(config.databaseFile));
try{await pool.query(await readFile(new URL('../server/monitor-alerts/schema.sql',import.meta.url),'utf8'));console.log('Monitor alerts schema ready')}finally{await pool.end()}
