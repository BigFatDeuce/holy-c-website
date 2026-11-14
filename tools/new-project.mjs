#!/usr/bin/env node
// Add a project to data/projects.json, pre-filled from its GitHub repository.
//
//   node tools/new-project.mjs Owner/Repo --region software
//   node tools/new-project.mjs Owner/Repo --region games --id my-game --name "My Game"
//
// It creates the entry (description, platforms guessed from topics, language, licence, latest release)
// and the folder assets/projects/<id>/ for the logo and screenshots. Texts are only a starting point:
// rewrite tagline, description and facts by hand, then add the images (see README.md).
import { formatJson } from './json-format.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const repo = args.find((a) => /^[\w.-]+\/[\w.-]+$/.test(a));
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
if (!repo) {
  console.error('Usage: node tools/new-project.mjs Owner/Repo --region <region id> [--id slug] [--name "Display name"]');
  process.exit(1);
}

const FILE = new URL('../data/projects.json', import.meta.url);
const data = JSON.parse(await readFile(FILE, 'utf8'));
const region = opt('region') || data.regions[0].id;
if (!data.regions.some((r) => r.id === region)) {
  console.error(`Unknown region "${region}". Known: ${data.regions.map((r) => r.id).join(', ')}. Add the region to data/projects.json first.`);
  process.exit(1);
}

let token = process.env.GITHUB_TOKEN || '';
if (!token) { try { token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {} }
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'holy-c-site-new-project' };
if (token) headers.Authorization = `Bearer ${token}`;
const gh = async (path) => { const r = await fetch(`https://api.github.com${path}`, { headers }); return r.ok ? r.json() : null; };

const info = await gh(`/repos/${repo}`);
if (!info) { console.error(`Repository ${repo} not found or not accessible.`); process.exit(1); }
const releases = (await gh(`/repos/${repo}/releases?per_page=5`)) || [];
const rel = releases.find((r) => !r.draft);

const baseName = repo.split('/')[1].replace(/-(game|app)$/i, '');
const id = opt('id') || baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const name = opt('name') || baseName.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
if (data.projects.some((p) => p.id === id)) { console.error(`A project with id "${id}" already exists.`); process.exit(1); }

const topics = info.topics || [];
const platforms = [
  ['windows', 'Windows'], ['linux', 'Linux'], ['macos', 'macOS'], ['android', 'Android'], ['ios', 'iOS'], ['web', 'Browser']
].filter(([k]) => topics.some((t) => t.includes(k))).map(([, v]) => v);
const homepage = info.homepage && !/github\.com/.test(info.homepage) ? info.homepage : '';

const project = {
  id,
  name,
  region,
  repo,
  tagline: info.description || '',
  description: info.description || '',
  platforms: platforms.length ? platforms : ['Windows'],
  stack: info.language || '',
  license: info.license && info.license.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : 'Free',
  facts: [],
  logo: `assets/projects/${id}/logo.webp`,
  shots: [`assets/projects/${id}/shot.webp`],
  links: homepage ? (region === 'games' ? { play: homepage } : { website: homepage }) : {},
  version: rel ? rel.tag_name.replace(/^v(?=\d)/i, '') : '',
  prerelease: rel ? !!rel.prerelease : false,
  released: rel ? (rel.published_at || rel.created_at).slice(0, 10) : ''
};

data.projects.push(project);
await writeFile(FILE, formatJson(data));
await mkdir(new URL(`../assets/projects/${id}/`, import.meta.url), { recursive: true });

console.log(`Added "${name}" (${id}) to region "${region}".`);
console.log('Still to do by hand:');
console.log('  - rewrite tagline, description and facts in data/projects.json');
console.log(`  - put logo and screenshot images in assets/projects/${id}/, then run: python tools/optimize_images.py assets/projects/${id}`);
console.log('  - check platforms, stack and links');
