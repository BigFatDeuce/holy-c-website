#!/usr/bin/env node
// Add every public repo of the owner that is not on the site yet and has at least one published release.
//
//   node tools/auto-add.mjs              add them (writes data/projects.json and assets/projects/<id>/)
//   node tools/auto-add.mjs --dry-run    only print what would be added
//   node tools/auto-add.mjs --only Repo  consider this repo even if it is already listed (with --dry-run, for testing)
//
// Runs in the scheduled GitHub Action. Everything is guessed from the repository: the zone (game or software),
// the name, tagline and description from the README, the platforms from the release files, the play link
// from the repo homepage, and the logo and first screenshot referenced by the README. New entries get
// "auto": true so they can be reviewed and rewritten by hand; the Action lists them in an issue.
// Needs Python 3 with Pillow for the images (tools/optimize_images.py).
import { formatJson } from './json-format.mjs';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OWNER = process.env.OWNER || 'BigFatDeuce';
const IGNORE = new Set((process.env.IGNORE_REPOS || 'holy-c-website').split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase()));
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const FILE = new URL('../data/projects.json', import.meta.url);
const ROOT = new URL('../', import.meta.url);
const data = JSON.parse(await readFile(FILE, 'utf8'));

let token = process.env.GITHUB_TOKEN || '';
if (!token) { try { token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {} }
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'holy-c-site-auto-add' };
if (token) headers.Authorization = `Bearer ${token}`;
const gh = async (path) => { const r = await fetch(`https://api.github.com${path}`, { headers }); return r.ok ? r.json() : null; };
const raw = async (repo, branch, path) => {
  const r = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${path.replace(/^\.?\//, '')}`);
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
};

/* ------------------------------------------------------------- README parsing */
const stripTags = (s) => s
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]+/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const sentence = (s, max) => {
  s = s.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '));
  return end > 40 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
};

function parseReadme(md) {
  const images = [...md.matchAll(/<img[^>]*\bsrc="([^"]+)"[^>]*>|!\[[^\]]*\]\(([^)\s]+)[^)]*\)/gi)]
    .map((m) => m[1] || m[2])
    .filter((src) => !/^https?:\/\/(img\.shields\.io|github\.com\/[^/]+\/[^/]+\/actions)/i.test(src) && !/badge/i.test(src));
  const heading = (md.match(/^#\s+(.+)$/m) || [])[1];
  const altName = ((md.match(/<img[^>]*\balt="([^"]+)"/i) || [])[1] || '').replace(/\s+(logo|icon|banner)$/i, '') || undefined;
  // Tagline: the first bold line near the top (centered intro blocks), else the first sentence of prose.
  const top = md.slice(0, 2500);
  const bold = (top.match(/<b>([^<]{12,160})<\/b>/i) || top.match(/^\s*\*\*([^*\n]{12,160})\*\*\s*$/m) || [])[1];
  // Description: the first real prose paragraph (not a heading, table, list, quote, HTML block or badge line).
  // Only look at the intro: stop at the first install / update / build / usage / licence section.
  const cut = md.search(/^##+\s.*\b(install|download|update|build|usage|play|licen[cs]e|credit|contribut|develop|controls|roadmap|faq)/im);
  const intro = cut > 0 ? md.slice(0, cut) : md;
  const paras = intro.split(/\n\s*\n/).map((p) => p.trim()).filter((p) =>
    p && !/^(#|\||[-*+] |\d+\. |>|<|```|\[!\[|!\[|---)/.test(p) && stripTags(p).length > 80);
  return {
    images,
    name: heading && !/[<>]/.test(heading) ? stripTags(heading) : altName,
    tagline: bold ? stripTags(bold) : null,
    description: paras.length ? stripTags(paras[0]) : null,
  };
}

/* -------------------------------------------------------------------- helpers */
const slug = (s) => s.toLowerCase().replace(/-game$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (s) => s.replace(/-game$/i, '').split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const isGame = (info, md) => /\b(game|fan ?game|jeu|godot)\b/i.test(`${info.name} ${info.description || ''} ${(info.topics || []).join(' ')} ${md.slice(0, 3000)}`);

function platformsOf(assets, homepage) {
  const n = assets.map((a) => a.name.toLowerCase()).join(' ');
  const out = [];
  if (homepage) out.push('Browser');
  if (/\.exe|\.msi|windows|win64|win-x64|_x64-setup/.test(n)) out.push('Windows');
  if (/\.appimage|\.deb|\.rpm|linux/.test(n)) out.push('Linux');
  if (/\.dmg|macos|darwin|osx/.test(n)) out.push('macOS');
  if (/\.apk|\.aab|android/.test(n)) out.push('Android');
  return out;
}

function safeSvg(buf) {
  const s = buf.toString('utf8');
  return /<svg[\s>]/i.test(s) && !/<script|\son\w+\s*=|javascript:|<foreignObject|href\s*=\s*["']https?:/i.test(s);
}

const imgExt = (path) => (path.split('?')[0].match(/\.(png|jpe?g|webp|gif|svg)$/i) || [])[1]?.toLowerCase();

/* ----------------------------------------------------------------------- main */
const listed = new Set(data.projects.map((p) => (p.repo || '').split('/')[1]?.toLowerCase()).filter(Boolean));
const repos = ((await gh(`/users/${OWNER}/repos?type=owner&per_page=100&sort=created`)) || [])
  .filter((r) => !r.fork && !r.private && !r.archived && !IGNORE.has(r.name.toLowerCase()))
  .filter((r) => (only ? r.name.toLowerCase() === only.toLowerCase() : !listed.has(r.name.toLowerCase())))
  .reverse(); // oldest first, so several new repos keep their creation order on the map

const added = [], skipped = [];
for (const info of repos) {
  const repo = info.full_name;
  const rel = ((await gh(`/repos/${repo}/releases?per_page=10`)) || []).find((r) => !r.draft);
  if (!rel) { skipped.push(`${info.name} (no release yet)`); continue; }

  const mdBuf = await raw(repo, info.default_branch, 'README.md');
  const md = mdBuf ? mdBuf.toString('utf8') : '';
  const rd = parseReadme(md);
  const region = isGame(info, md) && data.regions.some((r) => r.id === 'games') ? 'games' : data.regions[0].id;
  let id = slug(info.name);
  while (data.projects.some((p) => p.id === id)) id += '-2';
  const homepage = info.homepage && !/github\.com/i.test(info.homepage) ? info.homepage : null;
  const name = rd.name && rd.name.length <= 40 ? rd.name : titleCase(info.name);
  const tagline = sentence(rd.tagline || info.description || name, 110);
  const description = sentence(rd.description || info.description || tagline, 520);

  const p = {
    id, name, region, repo,
    tagline, description,
    platforms: platformsOf(rel.assets || [], homepage),
    stack: info.language || '',
    license: info.license && info.license.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : 'Free',
    facts: [],
    links: homepage ? { play: homepage } : {},
    version: rel.tag_name.replace(/^v/i, ''),
    prerelease: !!rel.prerelease,
    released: (rel.published_at || rel.created_at || '').slice(0, 10),
    auto: true,
  };

  // Images: the README's logo (an image whose path says logo/icon), then its first other image as the screenshot.
  const local = rd.images.filter((src) => !/^https?:/i.test(src) || src.includes(`raw.githubusercontent.com/${repo}/`))
    .map((src) => src.replace(new RegExp(`^https?://raw\\.githubusercontent\\.com/${repo}/[^/]+/`), ''))
    .filter((src) => imgExt(src));
  const logoSrc = local.find((s) => /logo/i.test(s)) || local.find((s) => /icon/i.test(s));
  const shotSrc = local.find((s) => s !== logoSrc && !/logo|icon|badge/i.test(s) && imgExt(s) !== 'svg' && imgExt(s) !== 'gif')
    || local.find((s) => s !== logoSrc && !/logo|icon|badge/i.test(s) && imgExt(s) === 'gif');

  if (!dry) {
    const dir = new URL(`assets/projects/${id}/`, ROOT);
    await mkdir(dir, { recursive: true });
    for (const [kind, src] of [['logo', logoSrc], ['shot', shotSrc]]) {
      if (!src) continue;
      const buf = await raw(repo, info.default_branch, src.replace(/^\.\//, ''));
      if (!buf || buf.length > 15e6) continue;
      const ext = imgExt(src);
      if (ext === 'svg' && !safeSvg(buf)) continue;
      await writeFile(new URL(`${kind}.${ext === 'jpeg' ? 'jpg' : ext}`, dir), buf);
    }
    try {
      execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', 'tools/optimize_images.py', `assets/projects/${id}`], { cwd: ROOT, stdio: 'inherit' });
    } catch (e) { console.error(`! ${id}: image optimisation failed (${e.message})`); }
    const files = await readdir(dir).catch(() => []);
    const logo = files.find((f) => /^logo\.(webp|svg)$/.test(f));
    const shot = files.find((f) => /^shot\.webp$/.test(f));
    if (logo) p.logo = `assets/projects/${id}/${logo}`;
    if (shot) p.shots = [`assets/projects/${id}/${shot}`];
    if (!files.length) await rm(dir, { recursive: true, force: true });
  } else {
    p.logo = logoSrc ? `(from ${logoSrc})` : undefined;
    p.shots = shotSrc ? [`(from ${shotSrc})`] : undefined;
  }

  // Same field order as the hand-written entries; insert after the last project of the same zone.
  const order = ['id', 'name', 'region', 'repo', 'tagline', 'description', 'platforms', 'stack', 'license', 'facts',
    'logo', 'logoWide', 'shots', 'portrait', 'links', 'version', 'prerelease', 'released', 'auto'];
  const entry = Object.fromEntries(order.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
  if (entry.logo && /\.webp$/.test(entry.logo) && !dry) {
    // A logo clearly wider than tall is shown as a wide logo.
    try {
      const out = execFileSync(process.platform === 'win32' ? 'python' : 'python3',
        ['-I', '-c', 'import sys;from PIL import Image;w,h=Image.open(sys.argv[1]).size;print(w/h)', new URL(entry.logo, ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
        { encoding: 'utf8' });
      if (parseFloat(out) > 1.3) entry.logoWide = true;
    } catch {}
  }
  const ordered = Object.fromEntries(order.filter((k) => entry[k] !== undefined).map((k) => [k, entry[k]]));
  const last = data.projects.map((x) => x.region).lastIndexOf(region);
  data.projects.splice(last + 1, 0, ordered);
  added.push(ordered);
  console.log(`+ ${id} (${region}) v${ordered.version}`);
  if (dry) console.log(JSON.stringify(ordered, null, 2));
}

skipped.forEach((s) => console.log(`  skipped ${s}`));
if (!added.length) console.log('No new project to add.');
if (added.length && !dry) await writeFile(FILE, formatJson(data));
