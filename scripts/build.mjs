#!/usr/bin/env node
/**
 * build.mjs — 组装 dist/。
 *
 *   dist/
 *     index.html …            静态页面
 *     assets/                 样式、脚本、同步数据
 *     data/                   config.json + 生成出来的 config.js / releases.js / mods.js
 *     downloads/              public/downloads/ 里手工上传的包
 *     _headers                Cloudflare Pages 响应头（GitHub Pages 会忽略）
 *
 * 生成物：
 *   data/config.js    window.__RBMK_CONFIG__
 *   data/releases.js  window.__RBMK_LOCAL__
 *   data/mods.js      window.__RBMK_MODS__
 */
import { readFile, writeFile, mkdir, rm, cp, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './release-labels.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const PAGES = [
  'index.html', 'wiki.html', 'wiki-rbmk.html', 'wiki-rbmk1.html',
  'downloads.html', 'credits.html', 'submit.html', 'mods.html', '404.html',
  // 旧地址跳转页
  'features.html', 'guide.html', 'screenshots.html', 'install.html',
  'commands.html', 'faq.html', 'changelog.html', 'download.html', 'about.html',
];

async function readJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); }
  catch { return fallback; }
}

async function copyDir(from, to) {
  if (!existsSync(from)) return 0;
  await cp(from, to, { recursive: true });
  return (await readdir(to, { recursive: true })).length;
}

function kb(n) { return `${(n / 1024).toFixed(1)} KB`; }

console.log('构建 dist/ …');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

// 1. 页面
for (const page of PAGES) {
  const src = join(ROOT, page);
  if (!existsSync(src)) { console.warn(`  ! 缺少页面 ${page}`); continue; }
  await cp(src, join(DIST, page));
  console.log(`  ✓ ${page}`);
}

// 2. assets（含 assets/data/*.js）
await copyDir(join(ROOT, 'assets'), join(DIST, 'assets'));
console.log('  ✓ assets/');

// 3. data：JSON 原样 + 三个生成脚本
await mkdir(join(DIST, 'data'), { recursive: true });
const configPath = join(ROOT, 'data', 'config.json');
const config = await readJson(configPath, null);
if (!config) throw new Error('data/config.json 读不出来，构建中止');

await cp(configPath, join(DIST, 'data', 'config.json'));
const configJs =
  '/* 自动生成，勿手改。源：data/config.json */\n' +
  `window.__RBMK_CONFIG__ = ${JSON.stringify(config)};\n`;
await writeFile(join(DIST, 'data', 'config.js'), configJs, 'utf8');
// 同时写回源目录：仓库根目录直接当站点用（不经 build）时也能跑
await writeFile(join(ROOT, 'data', 'config.js'), configJs, 'utf8');

const localReleases = await readJson(join(ROOT, 'data', 'releases.json'), { updated_at: null, mods: {} });
await cp(join(ROOT, 'data', 'releases.json'), join(DIST, 'data', 'releases.json'));
const localJs =
  '/* 自动生成，勿手改。源：data/releases.json */\n' +
  `window.__RBMK_LOCAL__ = ${JSON.stringify(localReleases)};\n`;
await writeFile(join(DIST, 'data', 'releases.js'), localJs, 'utf8');
await writeFile(join(ROOT, 'data', 'releases.js'), localJs, 'utf8');

const modsIndex = {
  updated_at: localReleases.updated_at || null,
  mods: (config.mods || []).map((m) => ({
    id: m.id, name: m.name, modid: m.modid, version: m.version,
  })),
};
await writeFile(
  join(DIST, 'data', 'mods.js'),
  '/* 自动生成，勿手改。源：data/config.json#mods */\n' +
  `window.__RBMK_MODS__ = ${JSON.stringify(modsIndex)};\n`,
  'utf8'
);
console.log('  ✓ data/（config.js / releases.js / mods.js 已生成）');

// 4. 手工上传的下载包
const dlCount = await copyDir(join(ROOT, 'public', 'downloads'), join(DIST, 'downloads'));
console.log(`  ✓ downloads/ — ${dlCount} 个文件`);

/* ---------- assets/data/latest.json：首页专用瘦身摘要 ----------
   首页只需要「每个模组的最新正式版 + 一个 jar + 下载量」，
   没必要解析 130 KB 的全量快照（Win7 上差别肉眼可见）。 */
const synced = await readJson(join(ROOT, 'assets', 'data', 'releases.json'), { repos: {} });
const local = await readJson(join(ROOT, 'data', 'releases.json'), { mods: {} });

function latestFor(mod) {
  let rows = [];
  for (const s of mod.sources || []) {
    rows = rows.concat((synced.repos || {})[`${s.platform}:${s.repo}`] || []);
  }
  for (const r of (local.mods || {})[mod.id] || []) {
    const { channel } = classify(r.tag || '', r.name || '', false);
    if (channel !== 'stable') return;
    rows.push({ tag: r.tag, name: r.name, date: r.date, prerelease: false, assets: r.files || [] });
  }
  const byDate = (a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0);
  const stable = rows.filter((r) => !r.prerelease).sort(byDate);
  const pick = stable[0] || rows.sort(byDate)[0];
  let jar = null, downloads = 0, hasCount = false;
  for (const a of (pick && pick.assets) || []) {
    if (/\.jar$/i.test(a.name) && !jar) jar = a;
    if (typeof a.downloads === 'number') { downloads += a.downloads; hasCount = true; }
  }
  return {
    id: mod.id, name: mod.name, shortName: mod.shortName, modid: mod.modid,
    tag: pick ? pick.tag : '', date: pick ? pick.date : '',
    file: jar ? { name: jar.name, url: jar.url, size: jar.size } : null,
    downloads: hasCount ? downloads : undefined,
  };
}

const latest = {
  updated_at: synced.updated_at || null,
  mods: (config.mods || []).map(latestFor),
};
const latestJson = JSON.stringify(latest, null, 2) + '\n';
for (const base of [DIST, ROOT]) {
  await mkdir(join(base, 'assets', 'data'), { recursive: true });
  await writeFile(join(base, 'assets', 'data', 'latest.json'), latestJson, 'utf8');
  await writeFile(
    join(base, 'assets', 'data', 'latest.js'),
    '/* 自动生成，勿手改。源：assets/data/releases.json */\n' +
    `window.__RBMK_LATEST__ = ${JSON.stringify(latest)};\n`,
    'utf8'
  );
}
console.log(`  ✓ assets/data/latest.json — ${(latestJson.length / 1024).toFixed(1)} KB（首页专用）`);

// 5. 响应头（Cloudflare Pages 用；GitHub Pages 忽略）与 .nojekyll
if (existsSync(join(ROOT, '_headers'))) {
  await cp(join(ROOT, '_headers'), join(DIST, '_headers'));
  console.log('  ✓ _headers');
}
await writeFile(join(DIST, '.nojekyll'), '', 'utf8');
console.log('  ✓ .nojekyll');

// 6. 统计
let total = 0;
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else total += (await stat(p)).size;
  }
}
await walk(DIST);
console.log(`\ndist/ 就绪：${kb(total)}`);
