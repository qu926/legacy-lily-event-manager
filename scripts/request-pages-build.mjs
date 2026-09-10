import { execFileSync } from 'node:child_process';

const credentials = execFileSync('git', ['-c', 'safe.directory=D:/Ai/tool/legacy-lily-event-manager', 'credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
});
const token = credentials.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
if (!token) throw new Error('GitHub credential unavailable');
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const base = 'https://api.github.com/repos/qu926/legacy-lily-event-manager';
const response = await fetch(`${base}/pages`, { headers });
if (!response.ok) throw new Error(`Pages inspection failed (${response.status})`);
const pages = await response.json();
console.log(JSON.stringify({ status: pages.status, build_type: pages.build_type, source: pages.source }));
if (process.argv.includes('--build')) {
  if (pages.build_type !== 'legacy' || pages.source?.branch !== 'gh-pages') throw new Error('Unexpected Pages source; no build requested');
  const build = await fetch(`${base}/pages/builds`, { method: 'POST', headers });
  console.log(JSON.stringify({ buildRequested: build.ok, status: build.status }));
  if (!build.ok) process.exitCode = 1;
}
