// Static server (npm run serve): serves sites/ plus read-only /viewer, /runs, /fixtures, and nothing else in the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStaticServer } from '../src/server.mjs';

// Raw request so "../" and %2e%2e reach the server exactly as written (fetch/URL would normalize them away).
const get = (port, rawPath, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: rawPath, method }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.end();
});

async function withServer(fn) {
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await fn(server.address().port); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('serve: sites/, viewer, fixtures are reachable', () => withServer(async (port) => {
  assert.equal((await get(port, '/testpage/original/')).status, 200);
  const viewer = await get(port, '/viewer/');
  assert.equal(viewer.status, 200);
  assert.match(viewer.body, /<html/);
  const report = await get(port, '/fixtures/testpage-original/report.json');
  assert.equal(report.status, 200);
  assert.ok(JSON.parse(report.body).verdicts);
}));

test('serve: never returns repo files outside the mounts, including via ../ and encoded traversal', () => withServer(async (port) => {
  const secrets = ['/.env', '/package.json', '/src/paths.mjs', '/src/', '/AGENTS.md', '/.git/HEAD', '/cli.mjs',
    '/../package.json', '/viewer/../package.json', '/viewer/../../package.json', '/fixtures/../src/paths.mjs',
    '/runs/../package.json', '/testpage/../../package.json', '/viewer/..%2fpackage.json', '/viewer/%2e%2e/package.json',
    '/viewer/%2e%2e%2f%2e%2e%2fpackage.json', '/%2e%2e/package.json', '/fixtures%2f..%2fpackage.json',
    '/viewer/..%5cpackage.json', '/viewerx/../package.json', '/viewer/%00', '/viewer/%zz'];
  for (const p of secrets) {
    const r = await get(port, p);
    assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status}`);
    assert.ok(!r.body.includes('a11y-task-audit') && !r.body.includes('insideDir'), `${p} leaked repo file content`);
  }
}));

test('serve: read-only (no methods other than GET/HEAD)', () => withServer(async (port) => {
  assert.equal((await get(port, '/viewer/', 'POST')).status, 405);
  assert.equal((await get(port, '/fixtures/testpage-original/report.json', 'PUT')).status, 405);
}));
