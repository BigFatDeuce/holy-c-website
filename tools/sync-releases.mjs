#!/usr/bin/env node
// Refresh "version", "prerelease" and "released" of every project in data/projects.json
// from the newest GitHub release of its "repo", and "license" from the licence GitHub detects in that repo
// (left alone when GitHub detects none, e.g. a custom licence text).
//
//   node tools/sync-releases.mjs            update the file
//   node tools/sync-releases.mjs --dry-run  only show what would change
//
// Uses GITHUB_TOKEN if set, otherwise `gh auth token` when the GitHub CLI is logged in,
// otherwise anonymous requests (60 per hour, enough for a few dozen projects).
import { formatJson } from './json-format.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const FILE = new URL('../data/projects.json', import.meta.url);
const dry = process.argv.includes('--dry-run');

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}
const t = token();
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'holy-c-site-sync' };
if (t) headers.Authorization = `Bearer ${t}`;

const data = JSON.parse(await readFile(FILE, 'utf8'));
let changes = 0;

for (const p of data.projects) {
  if (!p.repo) { console.log(`  ${p.id}: no repo, skipped`); continue; }
  const res = await fetch(`https://api.github.com/repos/${p.repo}/releases?per_page=10`, { headers });
  if (!res.ok) { console.warn(`! ${p.id}: GitHub answered HTTP ${res.status}`); continue; }
  const list = (await res.json()).filter((r) => !r.draft);
  if (!list.length) { console.log(`  ${p.id}: no release yet`); continue; }
  const rel = list[0];
  const next = {
    version: rel.tag_name.replace(/^v(?=\d)/i, ''),
    prerelease: !!rel.prerelease,
    released: (rel.published_at || rel.created_at).slice(0, 10)
  };
  const info = await fetch(`https://api.github.com/repos/${p.repo}`, { headers }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const spdx = info && info.license && info.license.spdx_id;
  if (spdx && spdx !== 'NOASSERTION') next.license = spdx;
  const diff = Object.keys(next).filter((k) => p[k] !== next[k]);
  if (!diff.length) { console.log(`  ${p.id}: up to date (${p.version})`); continue; }
  console.log(`* ${p.id}: ${diff.map((k) => `${k} ${JSON.stringify(p[k])} -> ${JSON.stringify(next[k])}`).join(', ')}`);
  Object.assign(p, next);
  changes++;
}

if (changes && !dry) {
  await writeFile(FILE, formatJson(data));
  console.log(`\n${changes} project(s) updated in data/projects.json`);
} else {
  console.log(changes ? `\n${changes} change(s) found (dry run, nothing written)` : '\nEverything is up to date');
}
