// Applies search/replace edits (NOT unified diffs: LLM line numbers are unreliable).
// Guard: an edit may add text (aria-label="Add to cart") but may not remove any visible text or string literal,
// so the fixer cannot "fix" an unannounced error by deleting the error message.
import fs from 'node:fs';
import path from 'node:path';

export function textTokens(src) {
  const toks = [];
  for (const m of src.matchAll(/>([^<>]+)</g)) toks.push(m[1]);                          // text nodes
  for (const m of src.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) toks.push(m[2]);         // string literals
  return toks.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1 && /[\p{L}\p{N}]/u.test(t));
}

export function checkEdit(e) {
  const newToks = new Set(textTokens(e.new));
  const newFlat = e.new.replace(/\s+/g, ' ');
  const lost = textTokens(e.old).filter((t) => !newToks.has(t) && !newFlat.includes(t));
  return lost.length ? `edit removes visible text/literals: ${lost.slice(0, 3).map((t) => JSON.stringify(t)).join(', ')}` : null;
}

/** @returns {{applied:number, errors:string[]}} — mutates files under siteDir */
export function applyEdits(siteDir, edits) {
  const errors = [];
  let applied = 0;
  const root = path.resolve(siteDir);
  for (const e of edits || []) {
    const file = path.resolve(root, e.file);
    if (!file.startsWith(root + path.sep)) { errors.push(`${e.file}: outside site dir`); continue; }
    if (!fs.existsSync(file)) { errors.push(`${e.file}: not found`); continue; }
    const src = fs.readFileSync(file, 'utf8');
    const count = src.split(e.old).length - 1;
    if (count !== 1) { errors.push(`${e.file}: "old" matched ${count} times (must be exactly 1)`); continue; }
    const bad = checkEdit(e);
    if (bad) { errors.push(`${e.file}: ${bad}`); continue; }
    fs.writeFileSync(file, src.replace(e.old, () => e.new));
    applied++;
  }
  return { applied, errors };
}
