// Applies search/replace edits (NOT unified diffs: LLM line numbers are unreliable).
// Guard: an edit may add text (aria-label="Add to cart") but may not remove any visible text or string literal,
// so the fixer cannot "fix" an unannounced error by deleting the error message.
import fs from 'node:fs';
import { insideDir } from '../paths.mjs';

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

/** @returns {{applied:number, errors:string[], appliedEdits:object[]}} — mutates files under siteDir */
export function applyEdits(siteDir, edits) {
  const errors = [];
  const appliedEdits = [];
  if (!Array.isArray(edits)) return { applied: 0, errors: ['edits must be an array'], appliedEdits };
  for (const e of edits) {
    if (typeof e?.file !== 'string' || typeof e.old !== 'string' || typeof e.new !== 'string' || !e.old) {
      errors.push(`invalid edit shape: ${JSON.stringify(e).slice(0, 120)}`); continue;
    }
    let file;
    try { file = insideDir(siteDir, e.file); } catch { errors.push(`${e.file}: outside site dir`); continue; }
    if (!fs.existsSync(file)) { errors.push(`${e.file}: not found`); continue; }
    const src = fs.readFileSync(file, 'utf8');
    const count = src.split(e.old).length - 1;
    if (count !== 1) { errors.push(`${e.file}: "old" matched ${count} times (must be exactly 1)`); continue; }
    const bad = checkEdit(e);
    if (bad) { errors.push(`${e.file}: ${bad}`); continue; }
    fs.writeFileSync(file, src.replace(e.old, () => e.new));
    appliedEdits.push({ file: e.file, old: e.old, new: e.new });
  }
  return { applied: appliedEdits.length, errors, appliedEdits };
}
