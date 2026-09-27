import fs from 'node:fs';
import path from 'node:path';
import { chatJSON } from '../agent/llm.mjs';
import { applyEdits } from './apply.mjs';

const SYSTEM = fs.readFileSync(new URL('../agent/prompts/fixer.md', import.meta.url), 'utf8');

function listFiles(dir) {
  return fs.readdirSync(dir, { recursive: true }).map(String)
    .filter((f) => /\.(html|js|mjs|css)$/.test(f)).map((f) => ({ file: f, content: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

const within = (dir, p) => { const rel = path.relative(dir, p); return !rel.startsWith('..') && !path.isAbsolute(rel); };
const overlaps = (a, b) => within(path.resolve(a), path.resolve(b)) || within(path.resolve(b), path.resolve(a));

/** Files most likely relevant to a finding: contain the selector's id/class token or the evidence text. */
function relevantFiles(files, finding) {
  const tokens = [...(finding.evidence.selector.match(/[#.][\w-]+/g) || []).map((t) => t.slice(1)), finding.evidence.text]
    .filter((t) => t && t.length > 2);
  const hits = files.filter((f) => tokens.some((t) => f.content.includes(t)));
  return (hits.length ? hits : files).filter((f) => f.content.length < 40_000).slice(0, 4);
}

/**
 * Fix the findings whose id is in `ids` (default: every block finding) on a COPY of the site. Original stays untouched so the demo can be repeated.
 * Sets `f.fix` to the edits actually applied (null if none were), so the viewer never shows a diff that is not in patched/.
 * `client` replaces the LLM client (tests only).
 * @returns {Promise<{finding:string, applied:number, errors:string[], rationale?:string}[]>}
 */
export async function fixSite({ findings, ids = null, originalDir, patchedDir, stats = {}, client }) {
  // patchedDir is wiped first: it must never be, contain, or sit inside the site it copies
  if (overlaps(originalDir, patchedDir)) throw new Error(`the patched copy (${patchedDir}) must be separate from the site (${originalDir})`);
  fs.rmSync(patchedDir, { recursive: true, force: true });
  fs.cpSync(originalDir, patchedDir, { recursive: true });
  const results = [];
  const chosen = ids ? findings.filter((x) => ids.includes(x.id)) : findings.filter((x) => x.impact === 'block');
  for (const f of findings) f.fix = null; // patchedDir was just rebuilt from the original: fixes of an earlier run are gone
  for (const f of chosen) {
    let feedback = null, res = { applied: 0, errors: ['not attempted'], appliedEdits: [] }, rationale;
    for (let attempt = 0; attempt < 2 && res.applied === 0; attempt++) {
      const files = relevantFiles(listFiles(patchedDir), f); // re-read: earlier fixes changed the files
      try {
        const { data } = await chatJSON({ role: 'fixer', system: SYSTEM, stats, client,
          user: JSON.stringify({ finding: { summary: f.summary, detector: f.detector, wcag: f.wcag, hint: f.hint, evidence: f.evidence },
            files, previousAttemptErrors: feedback }) });
        rationale = typeof data?.rationale === 'string' ? data.rationale : null;
        res = applyEdits(patchedDir, data?.edits);
      } catch (e) { res = { applied: 0, errors: [e.message], appliedEdits: [] }; }
      feedback = res.errors;
    }
    f.fix = res.applied ? { edits: res.appliedEdits, rationale } : null;
    results.push({ finding: f.id, applied: res.applied, errors: res.errors, rationale });
  }
  return results;
}
