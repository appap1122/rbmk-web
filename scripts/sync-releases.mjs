#!/usr/bin/env node
/**
 * sync-releases.mjs — 拉取 GitHub 与 Gitee 的发行版，归一化后写入
 *   assets/data/releases.json   （数据）
 *   assets/data/releases.js     （window.__RBMK_DATA__，file:// 预览用）
 *
 * 令牌从环境变量读，不落盘：
 *   GITHUB_TOKEN  （可选，私有库或避免限流时用）
 *   GITEE_TOKEN   （可选，Gitee 公开库匿名也能读，但限流更严）
 *
 * 用法： node scripts/sync-releases.mjs [--mod=rbmk]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './release-labels.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets', 'data');

const args = process.argv.slice(2);
const onlyMod = (args.find((a) => a.startsWith('--mod=')) || '').split('=')[1];

const cfg = JSON.parse(await readFile(join(ROOT, 'data', 'config.json'), 'utf8'));
const mods = (cfg.mods || []).filter((m) => !onlyMod || m.id === onlyMod);

function ghHeaders() {
  const h = {
    'User-Agent': 'rbmk-site-sync',
    Accept: 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `token ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

async function fetchGithub(repo) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const arr = await getJson(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
      ghHeaders()
    );
    if (!Array.isArray(arr) || !arr.length) break;
    out.push(...arr);
    if (arr.length < 100) break;
  }
  return out.map((r) => normalize({
    tag: r.tag_name,
    name: r.name || r.tag_name,
    notes: r.body || '',
    prerelease: !!r.prerelease,
    date: r.published_at || r.created_at,
    htmlUrl: r.html_url,
    assets: (r.assets || []).map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      size: a.size,
      downloads: typeof a.download_count === 'number' ? a.download_count : undefined,
    })),
  }));
}

async function fetchGitee(repo) {
  const out = [];
  const token = process.env.GITEE_TOKEN ? `&access_token=${encodeURIComponent(process.env.GITEE_TOKEN)}` : '';
  for (let page = 1; page <= 5; page++) {
    const arr = await getJson(
      `https://gitee.com/api/v5/repos/${repo}/releases?per_page=100&page=${page}${token}`,
      { 'User-Agent': 'rbmk-site-sync' }
    );
    if (!Array.isArray(arr) || !arr.length) break;
    out.push(...arr);
    if (arr.length < 100) break;
  }
  return out.map((r) => normalize({
    tag: r.tag_name,
    name: r.name || r.tag_name,
    notes: r.body || '',
    prerelease: !!r.prerelease,
    date: r.created_at || r.updated_at,
    htmlUrl: r.html_url || `https://gitee.com/${repo}/releases`,
    assets: (r.assets || []).map((a) => ({
      name: a.name,
      url: a.browser_download_url || a.url,
      size: a.size,
      // Gitee 不提供下载计数
    })),
  }));
}

function normalize(r) {
  const { channel, flags } = classify(r.tag, r.name, r.prerelease);
  return {
    tag: String(r.tag || ''),
    name: String(r.name || r.tag || ''),
    notes: String(r.notes || '').slice(0, 20000),
    prerelease: !!r.prerelease,
    date: r.date || '',
    htmlUrl: r.htmlUrl || '',
    channel,
    flags,
    assets: (r.assets || []).filter((a) => a && a.name && a.url),
  };
}

function dedupe(rows) {
  const seen = new Map();
  for (const r of rows) {
    const prev = seen.get(r.tag);
    // 同一 Tag 出现两次时保留资产更多的那份
    if (!prev || (r.assets.length > prev.assets.length)) seen.set(r.tag, r);
  }
  return [...seen.values()].sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0));
}

const repos = {};
const sources = [];
let ok = 0, failed = 0;

for (const mod of mods) {
  for (const src of mod.sources || []) {
    const key = `${src.platform}:${src.repo}`;
    sources.push({ platform: src.platform, repo: src.repo, mod: mod.id });
    try {
      const rows = src.platform === 'gitee' ? await fetchGitee(src.repo) : await fetchGithub(src.repo);
      repos[key] = dedupe(rows);
      ok++;
      console.log(`  ✓ ${key} — ${rows.length} 个发行版`);
    } catch (err) {
      failed++;
      repos[key] = [];
      console.warn(`  ✗ ${key} — ${err.message}`);
    }
  }
}

const data = {
  updated_at: new Date().toISOString(),
  sources,
  repos,
};

await mkdir(OUT_DIR, { recursive: true });
const jsonText = JSON.stringify(data, null, 2) + '\n';
await writeFile(join(OUT_DIR, 'releases.json'), jsonText, 'utf8');
await writeFile(
  join(OUT_DIR, 'releases.js'),
  '/* 自动生成，勿手改。数据源：assets/data/releases.json */\n' +
  `window.__RBMK_DATA__ = ${JSON.stringify(data)};\n`,
  'utf8'
);

// 兼容路径：旧工作流（.github/workflows/sync-releases.yml）只提交
// assets/releases.json。页面会在运行时再 fetch 这个文件做增量刷新，
// 所以即使新的 deploy.yml 还没启用，站点数据也是新鲜的。
await writeFile(join(ROOT, 'assets', 'releases.json'), jsonText, 'utf8');

const total = Object.values(repos).reduce((n, r) => n + r.length, 0);
console.log(`\n完成：${ok} 个源成功，${failed} 个失败，共 ${total} 条版本记录`);
console.log(`写入 assets/data/releases.json（${(JSON.stringify(data).length / 1024).toFixed(1)} KB）`);
if (failed) process.exitCode = 0; // 单个源失败不阻塞构建
