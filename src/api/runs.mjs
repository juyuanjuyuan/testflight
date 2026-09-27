// /api/* for the frontend (docs/API.md). P0: POST /api/runs starts an audit in a child process; progress.json shows it live.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SITES_DIR, insideDir } from '../paths.mjs';
import { newRunDir } from '../audit.mjs';
import { createProgressWriter, markFailedIfUnfinished } from '../report/progress.mjs';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_GOAL_CHARS = 500;
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
const NAME = /^[\w.-]+$/;
const SCRIPT_FILE = /^keys\.[\w.-]+\.json$/;

class ApiError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const bad = (code, message) => new ApiError(400, code, message);

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(obj));
}

/** runs/<name> if name is a plain dir name (^[\w.-]+$, not . or ..) that exists as a directory; otherwise null. */
export function runDirPath(runsDir, name) {
  if (!NAME.test(name) || name.startsWith('.')) return null;
  const dir = insideDir(runsDir, name);
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : null;
}

// Reads the whole body even past the limit (discarding it) so the client gets our 400 rather than a reset connection.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (d) => { size += d.length; if (size <= MAX_BODY_BYTES) chunks.push(d); });
    req.on('error', reject);
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return reject(bad('body_too_large', `The request is too large (limit ${MAX_BODY_BYTES / 1024} KB).`));
      if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') return reject(bad('invalid_body', 'The request must be JSON (Content-Type: application/json).'));
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reject(bad('invalid_body', 'The request body is not valid JSON.')); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(bad('invalid_body', 'The request body must be a JSON object.'));
      resolve(body);
    });
  });
}

// Only sites this server serves: a real site needs a human to clear captchas in Chrome and press Enter in a terminal.
function checkUrl(raw, ownPort) {
  let u;
  try { u = new URL(raw); } catch { throw bad('invalid_url', 'Enter a full web address starting with http:// or https://.'); }
  if (typeof raw !== 'string' || !['http:', 'https:'].includes(u.protocol)) throw bad('invalid_url', 'The address must start with http:// or https://.');
  if (u.protocol !== 'http:' || !LOCAL_HOSTS.includes(u.hostname) || Number(u.port || 80) !== ownPort) {
    throw bad('real_site_cli_only', 'Only the demo sites on this server can be audited from the web page. Real websites are audited from the command line.');
  }
  let segs;
  try { segs = u.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { segs = []; }
  const [a, b] = segs;
  const ok = [a, b].every((s) => s && NAME.test(s) && !s.startsWith('.')) && fs.existsSync(insideDir(SITES_DIR, path.join(a, b)));
  if (!ok) throw bad('unknown_site', 'There is no demo site at this address. Try one like /shop/original/.');
  return { url: raw, site: `sites/${a}/${b}` }; // meta.site: lets `fix` find the source folder later
}

function checkGoal(goal) {
  if (typeof goal !== 'string' || !goal.trim()) throw bad('invalid_goal', 'Describe the task to try, for example "Buy the canvas tote bag".');
  if (goal.length > MAX_GOAL_CHARS) throw bad('invalid_goal', `The task description is too long (at most ${MAX_GOAL_CHARS} characters).`);
  return goal;
}

// Pre-recorded key scripts (deterministic demo/test runs) are limited to eval/keys.*.json.
function checkScript(script) {
  const file = typeof script === 'string' && SCRIPT_FILE.test(script) ? path.join(ROOT, 'eval', script) : null;
  if (!file || !fs.existsSync(file)) throw bad('invalid_script', 'Unknown key script. Use the name of an eval/keys.*.json file.');
  return file;
}

// "error: <msg> (DEBUG=1 for details)" from cli.mjs → "<msg>"
function exitMessage({ code, signal, stderr }) {
  const last = String(stderr || '').trim().split('\n').filter(Boolean).pop();
  const why = last ? last.replace(/^error: /, '').replace(/ \(DEBUG=1 for details\)$/, '') : signal ? `killed by ${signal}` : `exit code ${code}`;
  return `The audit stopped unexpectedly: ${why}`;
}

/**
 * Returns handle(req, res) for /api/*. spawnRun({runDir, argv}) → Promise<{code, signal, stderr}> (injected in tests);
 * ownPort() is this server's port (only its own sites are accepted); log records failures the HTTP client can't see.
 */
export function createRunsApi({ runsDir, spawnRun, ownPort, log = () => {} }) {
  let active = false; // one run at a time (P1 fix/rerun share this lock)

  async function startRun(req, res) {
    const body = await readJsonBody(req);
    const { url, site } = checkUrl(body.url, ownPort());
    const goal = checkGoal(body.goal);
    const script = body.script === undefined ? null : checkScript(body.script);
    if (active) throw new ApiError(409, 'run_in_progress', 'Another run is already in progress. Wait for it to finish.');
    active = true;
    let runDir = null;
    try {
      runDir = newRunDir(runsDir, 'audit');
      createProgressWriter(runDir)({ state: 'running', trace: [] }); // exists before we answer: the client polls it at once
      const argv = ['audit', '--url', url, '--goal', goal, '--run-dir', runDir, '--site', site, '--progress',
        ...(script ? ['--script', script, '--no-judge'] : [])];
      spawnRun({ runDir, argv })
        .then((exit) => markFailedIfUnfinished(runDir, exitMessage(exit)), (e) => markFailedIfUnfinished(runDir, exitMessage({ stderr: e.message })))
        .catch((e) => log(`could not record the end of run ${path.basename(runDir)}: ${e.message}`))
        .finally(() => { active = false; });
    } catch (e) {
      active = false;
      if (runDir) markFailedIfUnfinished(runDir, 'The audit could not be started.');
      throw e;
    }
    send(res, 202, { runDir: path.basename(runDir) });
  }

  async function route(req, res) {
    const segs = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean); // ['api', 'runs', …]
    if (segs[1] === 'runs' && segs.length === 2) {
      if (req.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Use POST to start a run.');
      return startRun(req, res);
    }
    if (segs[1] === 'runs') {
      let name = null;
      try { name = decodeURIComponent(segs[2]); } catch { /* malformed escape: same answer as any unknown run */ }
      if (!name || !runDirPath(runsDir, name)) throw new ApiError(404, 'run_not_found', 'This run does not exist.');
    }
    throw new ApiError(404, 'not_found', 'There is no such API endpoint.');
  }

  return async (req, res) => {
    try { await route(req, res); } catch (e) {
      if (e instanceof ApiError) return send(res, e.status, { error: { code: e.code, message: e.message } });
      log(`api error: ${e.stack || e.message}`);
      send(res, 500, { error: { code: 'internal_error', message: `Something went wrong on the server: ${e.message.split('\n')[0]}` } });
    }
  };
}
