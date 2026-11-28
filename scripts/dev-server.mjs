#!/usr/bin/env node
/**
 * dev-server.mjs — 零依赖本地预览服务器。
 *   node scripts/dev-server.mjs [--port=4173] [--dist]
 * 默认服务仓库根目录；加 --dist 则服务 dist/。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const useDist = args.includes('--dist');
const port = Number((args.find((a) => a.startsWith('--port=')) || '').split('=')[1] || process.env.PORT || 4173);
const BASE = useDist ? join(ROOT, 'dist') : ROOT;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jar': 'application/java-archive',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    let file = normalize(join(BASE, pathname));
    if (!file.startsWith(BASE)) { res.writeHead(403).end('forbidden'); return; }

    if (!existsSync(file)) {
      const notFound = join(BASE, '404.html');
      if (existsSync(notFound)) {
        res.writeHead(404, { 'Content-Type': MIME['.html'] });
        res.end(await readFile(notFound));
      } else {
        res.writeHead(404).end('404');
      }
      return;
    }
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(port, () => {
  console.log(`本地预览： http://127.0.0.1:${port}/   （根目录：${useDist ? 'dist/' : './'}）`);
});
