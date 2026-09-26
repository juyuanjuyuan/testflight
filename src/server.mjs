// Zero-dependency read-only static server: sites/ at the root, plus the viewer and its data under fixed mounts.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RUNS_DIR, SITES_DIR, insideDir } from './paths.mjs';

const MOUNTS = { '/viewer': path.join(ROOT, 'viewer'), '/runs': RUNS_DIR, '/fixtures': path.join(ROOT, 'fixtures') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

// URL pathname → file path. Every result goes through insideDir, so ../ (raw or encoded) can't leave its mount.
function resolvePath(urlPath) {
  const pathname = decodeURIComponent(new URL(urlPath, 'http://x').pathname);
  if (pathname.includes('\0')) throw new Error('NUL in path');
  const mount = Object.keys(MOUNTS).find((m) => pathname === m || pathname.startsWith(m + '/'));
  return mount ? insideDir(MOUNTS[mount], '.' + pathname.slice(mount.length)) : insideDir(SITES_DIR, '.' + pathname);
}

/** Returns an http.Server (not listening) serving sites/ at / and viewer/, runs/, fixtures/ at /viewer, /runs, /fixtures. */
export function createStaticServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
    let p;
    try { p = resolvePath(req.url); } catch { res.writeHead(403).end(); return; } // traversal or malformed URL: refuse, the status is the record
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(p).pipe(res);
  });
}
