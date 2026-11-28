#!/usr/bin/env node
/**
 * admin-server.js — 本地管理后台（零依赖，只用 node 内置模块）。
 *
 *   node admin-server.js            → http://127.0.0.1:8787
 *   PORT=9000 node admin-server.js
 *
 * 只监听回环地址，不对外网开放。能做的事：
 *   · 编辑 data/config.json（全站文案）
 *   · 维护 data/releases.json（手工发布的版本，优先级高于上游同步数据）
 *   · 上传 .jar / .zip 到 public/downloads/，并自动登记成一条手工发布
 *   · 触发 npm run sync / npm run build，并回显日志
 *
 * 说明：这里不写 assets/data/releases.json（那是同步脚本的产物），
 * 手工发布统一写在 data/releases.json，build 时合并进 dist。
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, extname, join, normalize, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';

const P = {
  config: join(ROOT, 'data', 'config.json'),
  local: join(ROOT, 'data', 'releases.json'),
  synced: join(ROOT, 'assets', 'data', 'releases.json'),
  uploads: join(ROOT, 'public', 'downloads'),
  admin: join(ROOT, 'admin'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const readJson = async (p, fb) => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; }
};

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* 极简 multipart 解析：够用即可（单文件、无嵌套） */
function parseMultipart(buf, contentType) {
  const m = /boundary=([^;]+)/i.exec(contentType || '');
  if (!m) throw new Error('缺少 boundary');
  const boundary = Buffer.from('--' + m[1].replace(/^"|"$/g, ''));
  const parts = [];
  let idx = buf.indexOf(boundary);
  while (idx !== -1) {
    const next = buf.indexOf(boundary, idx + boundary.length);
    if (next === -1) break;
    const chunk = buf.subarray(idx + boundary.length + 2, next - 2); // 去掉 CRLF
    const sep = chunk.indexOf('\r\n\r\n');
    if (sep > 0) {
      const headers = chunk.subarray(0, sep).toString('utf8');
      const data = chunk.subarray(sep + 4);
      const nameM = /name="([^"]*)"/i.exec(headers);
      const fileM = /filename="([^"]*)"/i.exec(headers);
      parts.push({ name: nameM ? nameM[1] : '', filename: fileM ? fileM[1] : null, data });
    }
    idx = next;
  }
  return parts;
}

function runTask(task) {
  const map = { sync: ['scripts/sync-releases.mjs'], build: ['scripts/build.mjs'] };
  const args = map[task];
  if (!args) return Promise.reject(new Error('未知任务'));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: process.env });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => resolve({ code, out }));
  });
}

function serveFile(res, file) {
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  readFile(file).then((body) => {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': body.length });
    res.end(body);
  }).catch(() => { res.writeHead(404).end('404'); });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  try {
    /* ---------------- 静态 ---------------- */
    if (req.method === 'GET' && (path === '/' || path === '/admin' || path === '/admin/')) {
      return serveFile(res, join(P.admin, 'index.html'));
    }
    if (req.method === 'GET' && path.startsWith('/admin/')) {
      const f = normalize(join(P.admin, path.slice('/admin/'.length)));
      return f.startsWith(P.admin) ? serveFile(res, f) : json(res, 403, { error: 'forbidden' });
    }
    if (req.method === 'GET' && path.startsWith('/assets/')) {
      const f = normalize(join(ROOT, path));
      return f.startsWith(ROOT) ? serveFile(res, f) : json(res, 403, { error: 'forbidden' });
    }

    /* ---------------- API ---------------- */
    if (path === '/api/state' && req.method === 'GET') {
      const [config, local, synced] = await Promise.all([
        readJson(P.config, null), readJson(P.local, { mods: {} }), readJson(P.synced, { repos: {} }),
      ]);
      let uploads = [];
      try { uploads = await readdir(P.uploads); } catch { /* 目录不存在 */ }
      const syncedSummary = Object.fromEntries(
        Object.entries(synced.repos || {}).map(([k, v]) => [k, v.length])
      );
      return json(res, 200, {
        config, local, uploads,
        synced: { updated_at: synced.updated_at || null, repos: syncedSummary },
      });
    }

    if (path === '/api/config' && req.method === 'PUT') {
      const raw = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(raw.toString('utf8')); }
      catch (e) { return json(res, 400, { error: 'JSON 解析失败：' + e.message }); }
      const backup = P.config + '.bak';
      try { await writeFile(backup, await readFile(P.config)); } catch { /* 首次 */ }
      await writeFile(P.config, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
      return json(res, 200, { ok: true, backup: basename(backup) });
    }

    if (path === '/api/local' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const { mod, tag } = body;
      if (!mod || !tag) return json(res, 400, { error: 'mod / tag 必填' });
      const local = await readJson(P.local, { mods: {} });
      local.mods = local.mods || {};
      local.mods[mod] = local.mods[mod] || [];
      const entry = {
        tag: String(tag),
        name: String(body.name || tag),
        notes: String(body.notes || ''),
        date: body.date || new Date().toISOString(),
        htmlUrl: body.htmlUrl || '',
        files: Array.isArray(body.files) ? body.files : [],
      };
      const i = local.mods[mod].findIndex((x) => x.tag === entry.tag);
      if (i >= 0) local.mods[mod][i] = entry; else local.mods[mod].unshift(entry);
      local.updated_at = new Date().toISOString();
      await writeFile(P.local, JSON.stringify(local, null, 2) + '\n', 'utf8');
      return json(res, 200, { ok: true, entry });
    }

    if (path === '/api/local' && req.method === 'DELETE') {
      const mod = url.searchParams.get('mod');
      const tag = url.searchParams.get('tag');
      const local = await readJson(P.local, { mods: {} });
      if (local.mods?.[mod]) {
        local.mods[mod] = local.mods[mod].filter((x) => x.tag !== tag);
        local.updated_at = new Date().toISOString();
        await writeFile(P.local, JSON.stringify(local, null, 2) + '\n', 'utf8');
      }
      return json(res, 200, { ok: true });
    }

    if (path === '/api/upload' && req.method === 'POST') {
      const buf = await readBody(req);
      const parts = parseMultipart(buf, req.headers['content-type']);
      const file = parts.find((p) => p.filename);
      if (!file) return json(res, 400, { error: '没有收到文件' });
      const safe = basename(file.filename).replace(/[^\w.\-]+/g, '_');
      await mkdir(P.uploads, { recursive: true });
      const target = join(P.uploads, safe);
      await writeFile(target, file.data);
      const size = (await stat(target)).size;
      return json(res, 200, {
        ok: true,
        name: safe,
        size,
        url: 'downloads/' + encodeURIComponent(safe),
      });
    }

    if (path === '/api/run' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const r = await runTask(body.task);
      return json(res, 200, r);
    }

    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, 500, { error: String(err && err.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`管理后台： http://${HOST}:${PORT}/  （只监听本机回环）`);
  console.log('  改文案 → data/config.json；手工发布 → data/releases.json；上传 → public/downloads/');
});
