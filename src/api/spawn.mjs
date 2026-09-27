// Runs execute in a child `node cli.mjs …`: a browser or model failure can't take the server down, and a crash is visible as an exit.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../paths.mjs';

const STDERR_TAIL = 4000; // enough for the CLI's one-line error; the full output is in cli.log

/**
 * Spawn `node cli.mjs <argv>` in the repo root (so .env is found); stdout+stderr go to runDir/cli.log.
 * Resolves (never rejects) on exit with {code, signal, stderr} — stderr is the tail, used for the failed message.
 */
export function spawnCliRun({ runDir, argv }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'cli.mjs'), ...argv], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = fs.createWriteStream(path.join(runDir, 'cli.log'));
    let stderr = '';
    child.stdout.on('data', (d) => log.write(d));
    child.stderr.on('data', (d) => { log.write(d); stderr = (stderr + d).slice(-STDERR_TAIL); });
    // 'error' = the process could not be started at all; resolve so the caller marks the run failed
    child.on('error', (e) => { log.end(); resolve({ code: null, signal: null, stderr: `could not start the audit process: ${e.message}` }); });
    child.on('close', (code, signal) => { log.end(); resolve({ code, signal, stderr }); });
  });
}
