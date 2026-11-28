#!/usr/bin/env node
/**
 * smoke-downloads.mjs — 下载页冒烟测试（不依赖浏览器 / jsdom）。
 *
 * 检查四件事：
 *   1. data/config.json 结构完整，两个模组的 sources 齐备
 *   2. assets/data/releases.json 能解析，每个 mod 至少有一条版本
 *   3. 每个版本的资产链接是绝对 http(s)，jar 文件名合法
 *   4. 标签判定规则与预期一致（含 -beta / -preview / hotfix / major / unstable）
 *   5. 页面里引用的本地脚本与样式都存在
 *
 * 用法： node scripts/smoke-downloads.mjs
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './release-labels.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failed++; console.error(`  ✗ ${m}`); };

console.log('smoke: 配置');
const cfg = JSON.parse(await readFile(join(ROOT, 'data', 'config.json'), 'utf8'));
if (!cfg.site?.title) bad('config.site.title 缺失'); else ok('site.title');
if (!Array.isArray(cfg.mods) || cfg.mods.length < 2) bad('config.mods 少于 2 条');
else ok(`${cfg.mods.length} 个模组`);
for (const m of cfg.mods || []) {
  if (!m.id || !m.modid) bad(`模组缺 id/modid：${JSON.stringify(m).slice(0, 60)}`);
  if (!Array.isArray(m.sources) || !m.sources.length) bad(`模组 ${m.id} 没有 sources`);
  for (const s of m.sources || []) {
    if (!['github', 'gitee'].includes(s.platform)) bad(`${m.id} 的 source.platform 非法：${s.platform}`);
    if (!/^[\w.-]+\/[\w.-]+$/.test(s.repo || '')) bad(`${m.id} 的 source.repo 非法：${s.repo}`);
  }
}

console.log('smoke: 同步数据');
const dataPath = join(ROOT, 'assets', 'data', 'releases.json');
if (!existsSync(dataPath)) {
  bad('assets/data/releases.json 不存在（先跑 npm run sync）');
} else {
  const data = JSON.parse(await readFile(dataPath, 'utf8'));
  if (!data.updated_at) bad('updated_at 缺失'); else ok(`updated_at ${data.updated_at}`);
  const repos = data.repos || {};
  let total = 0;
  for (const m of cfg.mods) {
    for (const s of m.sources) {
      const key = `${s.platform}:${s.repo}`;
      const rows = repos[key];
      if (!Array.isArray(rows)) { bad(`${key} 缺失`); continue; }
      total += rows.length;
      if (!rows.length) { bad(`${key} 是空的`); continue; }
      rows.forEach((r) => {
        if (!r.tag) bad(`${key} 有记录缺 tag`);
        if (!r.channel) bad(`${key}#${r.tag} 缺 channel`);
        (r.assets || []).forEach((a) => {
          if (!/^https?:\/\//.test(a.url || '')) bad(`${key}#${r.tag} 资产链接非绝对地址：${a.name}`);
        });
      });
      ok(`${key} — ${rows.length} 条`);
    }
  }
  if (!total) bad('一条版本记录都没有');
}

console.log('smoke: 标签规则');
const cases = [
  ['18.3', 'v18.3', false, 'stable', []],
  ['18.2', 'v18.2', false, 'stable', []],
  ['15.2-beta', 'v15.2-beta', false, 'beta', []],
  ['14.1-hotfix-beta', 'hotfix', false, 'beta', ['hotfix']],
  ['1.0.0', '1.0.0 正式版', false, 'stable', []],
  ['11.0-preview', 'preview', false, 'preview', []],
  ['17.0-major', 'major 更新', false, 'stable', ['major']],
  ['16.0', '不稳定实验版', false, 'stable', ['unstable']],
  ['13.0', 'v13.0', true, 'beta', []],
];
for (const [tag, name, pre, ch, flags] of cases) {
  const r = classify(tag, name, pre);
  const good = r.channel === ch && JSON.stringify(r.flags) === JSON.stringify(flags);
  if (good) ok(`${tag} -> ${ch}${flags.length ? ' +' + flags.join(',') : ''}`);
  else bad(`${tag} 期望 ${ch}/${flags} 实际 ${r.channel}/${r.flags}`);
}

console.log('smoke: 页面引用');
const pages = ['index.html', 'downloads.html', 'wiki.html', 'wiki-rbmk.html', 'wiki-rbmk1.html', 'credits.html', 'submit.html', '404.html', 'mods.html'];
const need = [
  'assets/css/style.css',
  'assets/js/content.js',
  'assets/js/site.js',
  'assets/js/mods.js',
  'data/config.js',
];
for (const p of pages) {
  const full = join(ROOT, p);
  if (!existsSync(full)) { bad(`页面缺失 ${p}`); continue; }
  const html = await readFile(full, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#?]+\.(?:js|css))"/g)].map((m) => m[1]);
  const missing = refs.filter((r) => !existsSync(join(ROOT, r)));
  if (missing.length) bad(`${p} 引用了不存在的文件：${missing.join(', ')}`);
  else ok(`${p}（${refs.length} 个本地引用）`);
}
for (const f of need) if (!existsSync(join(ROOT, f))) bad(`缺少公共文件 ${f}`);

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
