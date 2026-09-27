// Zero-dependency server: sites/ at the root, the viewer and its data under fixed read-only mounts, and /api/* (src/api/).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RUNS_DIR, SITES_DIR, insideDir } from './paths.mjs';
import { createRunsApi } from './api/runs.mjs';
import { spawnCliRun } from './api/spawn.mjs';

// Loopback only: /api can launch a browser at a URL, which must not be reachable from the rest of the network.
export const HOST = '127.0.0.1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

// URL pathname → file path. Every result goes through insideDir, so ../ (raw or encoded) can't leave its mount.
function resolvePath(mounts, urlPath) {
  const pathname = decodeURIComponent(new URL(urlPath, 'http://x').pathname);
  if (pathname.includes('\0')) throw new Error('NUL in path');
  const mount = Object.keys(mounts).find((m) => pathname === m || pathname.startsWith(m + '/'));
  return mount ? insideDir(mounts[mount], '.' + pathname.slice(mount.length)) : insideDir(SITES_DIR, '.' + pathname);
}

const isApi = (url) => { const p = new URL(url, 'http://x').pathname; return p === '/api' || p.startsWith('/api/'); };

/**
 * Returns an http.Server (not listening; use listen()) serving sites/ at /, viewer/, runs/, fixtures/ read-only at
 * /viewer, /runs, /fixtures, and /api/*. runsDir and spawnRun are injectable for tests; log gets server-side errors.
 */
export function createStaticServer({ runsDir = RUNS_DIR, spawnRun = spawnCliRun, log = () => {} } = {}) {
  const mounts = { '/viewer': path.join(ROOT, 'viewer'), '/runs': runsDir, '/fixtures': path.join(ROOT, 'fixtures') };
  const server = http.createServer((req, res) => {
    if (isApi(req.url)) { api(req, res); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
    let p;
    try { p = resolvePath(mounts, req.url); } catch { res.writeHead(403).end(); return; } // traversal or malformed URL: refuse, the status is the record
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(p).pipe(res);
  });
  const api = createRunsApi({ runsDir, spawnRun, log, ownPort: () => server.address().port });
  return server;
}

/** Start listening on HOST:port (0 = any free port). Resolves with the server; rejects on e.g. EADDRINUSE. */
export function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => { server.off('error', reject); resolve(server); });
  });
}
