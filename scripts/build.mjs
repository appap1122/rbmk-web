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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const PAGES = [
  'index.html', 'wiki.html', 'wiki-rbmk.html', 'wiki-rbmk1.html',
  'downloads.html', 'submit.html', 'mods.html', '404.html',
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
