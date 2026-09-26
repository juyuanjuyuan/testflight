// Zero-dependency static server for sites/ → http://localhost:8080/shop/original/ etc.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { SITES_DIR as root, insideDir } from '../src/paths.mjs';
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  let p;
  try { p = insideDir(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname)); }
  catch { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`serving sites/ on http://localhost:${port}/`));
