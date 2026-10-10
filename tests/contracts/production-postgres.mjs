import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import pg from 'pg';
import { createPool } from '../../server/shared/store.mjs';
import { migrate } from '../../db/migrate.mjs';

// Test-only independent cluster. Never reads production DB URLs or credentials.
export async function createTestPostgres(root) {
  root = resolve(root); mkdirSync(root, { recursive: true });
  const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/17/bin', data = join(root, 'pgdata');
  const command = async (name, args) => {
    const exe = join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
    if (name === 'pg_ctl') return new Promise((ok, bad) => { const child = spawn(exe, args, { windowsHide: true, stdio: 'ignore' }); child.once('error', bad); child.once('exit', n => n === 0 ? ok() : bad(Error('Test pg_ctl failed'))); });
    return promisify(execFile)(exe, args, { windowsHide: true });
  };
  let started = false, admin, pools = {};
  const close = async () => { await Promise.allSettled(Object.values(pools).map(p => p.end())); await admin?.end(); if (started) { await command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']); started = false; } };
  try {
    const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const port = socket.address().port; await new Promise(r => socket.close(r));
    await command('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
    await command('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']); started = true;
    const url = (role, database = 'production_test') => `postgresql://${role}@127.0.0.1:${port}/${database}`;
    admin = new pg.Client({ connectionString: url('postgres', 'postgres') }); await admin.connect();
    await admin.query('CREATE ROLE lp_owner NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_api LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_jobs LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_ingest LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_executor LOGIN NOSUPERUSER NOBYPASSRLS;');
    await admin.query('CREATE DATABASE production_test OWNER lp_owner'); await admin.end();
    admin = new pg.Client({ connectionString: url('postgres') }); await admin.connect();
    await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC'); await migrate(admin); await migrate(admin);
    pools = { executor: createPool(url('lp_executor')), api: createPool(url('lp_api')), jobs: createPool(url('lp_jobs')) };
    return { admin, pools, url, close };
  } catch (e) { await close(); throw e; }
}
