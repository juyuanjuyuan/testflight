// All file locations are anchored to the repo root, never to process.cwd().
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RUNS_DIR = path.join(ROOT, 'runs');
export const CACHE_DIR = path.join(ROOT, '.cache', 'llm');
export const SITES_DIR = path.join(ROOT, 'sites');

/** Resolve `rel` inside `base`; throws if it escapes (paths from users or LLMs). */
export function insideDir(base, rel) {
  const root = path.resolve(base);
  const p = path.resolve(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error(`path escapes ${root}: ${rel}`);
  return p;
}
