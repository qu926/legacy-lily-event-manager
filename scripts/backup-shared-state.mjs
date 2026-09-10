import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const context = vm.createContext({ window: {} });
vm.runInContext(await fs.readFile(new URL('../js/config.js', import.meta.url), 'utf8'), context);
const config = context.window.EVENT_MANAGER_CONFIG;
const headers = { apikey: config.supabaseAnonKey };
if (!config.supabaseAnonKey.startsWith('sb_publishable_')) headers.Authorization = `Bearer ${config.supabaseAnonKey}`;
const rowId = config.stateRowId || config.appId;
if (!rowId || !config.supabaseUrl) throw new Error('Missing database configuration');
const url = new URL('/rest/v1/app_state', config.supabaseUrl);
url.searchParams.set('id', `eq.${rowId}`);
url.searchParams.set('select', 'id,payload,updated_at');
const response = await fetch(url, { headers });
if (!response.ok) throw new Error(`Database read failed (${response.status})`);
const rows = await response.json();
if (rows.length !== 1 || !Array.isArray(rows[0].payload?.event_dates)) throw new Error('Invalid backup response');
const bytes = JSON.stringify(rows[0], null, 2);
const directory = path.join(fileURLToPath(new URL('../..', import.meta.url)), 'legacy-lily-private-backups');
await fs.mkdir(directory, { recursive: true });
const filename = path.join(directory, `state-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o600 });
const restored = await fs.readFile(filename, 'utf8');
if (restored !== bytes) throw new Error('Backup verification failed');
console.log(JSON.stringify({ backup: filename, sha256: createHash('sha256').update(restored).digest('hex'), verified: true,
  counts: Object.fromEntries(Object.entries(rows[0].payload).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])) }));
