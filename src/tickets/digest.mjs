import { createHash } from 'node:crypto';

// Hash exact persisted JSON, including key order. Bundle publishers must retain it.
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
