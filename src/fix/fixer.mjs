import fs from 'node:fs';
import path from 'node:path';
import { chatJSON } from '../agent/llm.mjs';
import { applyEdits } from './apply.mjs';

const SYSTEM = fs.readFileSync(new URL('../agent/prompts/fixer.md', import.meta.url), 'utf8');

function listFiles(dir) {
  return fs.readdirSync(dir, { recursive: true }).map(String)
    .filter((f) => /\.(html|js|mjs|css)$/.test(f)).map((f) => ({ file: f, content: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

/** Files most likely relevant to a finding: contain the selector's id/class token or the evidence text. */
function relevantFiles(files, finding) {
  const tokens = [...(finding.evidence.selector.match(/[#.][\w-]+/g) || []).map((t) => t.slice(1)), finding.evidence.text]
    .filter((t) => t && t.length > 2);
  const hits = files.filter((f) => tokens.some((t) => f.content.includes(t)));
  return (hits.length ? hits : files).filter((f) => f.content.length < 40_000).slice(0, 4);
}

/**
 * Fix every block finding on a COPY of the site. Original stays untouched so the demo can be repeated.
 * @returns {Promise<{finding:string, applied:number, errors:string[], rationale?:string}[]>}
 */
export async function fixSite({ findings, originalDir, patchedDir, stats = {} }) {
  fs.rmSync(patchedDir, { recursive: true, force: true });
  fs.cpSync(originalDir, patchedDir, { recursive: true });
  const results = [];
  for (const f of findings.filter((x) => x.impact === 'block')) {
    let feedback = null, res = { applied: 0, errors: ['not attempted'] }, rationale;
    for (let attempt = 0; attempt < 2 && res.applied === 0; attempt++) {
      const files = relevantFiles(listFiles(patchedDir), f); // re-read: earlier fixes changed the files
      try {
        const { data } = await chatJSON({ role: 'fixer', system: SYSTEM, stats,
          user: JSON.stringify({ finding: { summary: f.summary, detector: f.detector, wcag: f.wcag, hint: f.hint, evidence: f.evidence },
            files, previousAttemptErrors: feedback }) });
        rationale = data.rationale;
        res = applyEdits(patchedDir, data.edits);
        f.fix = { edits: data.edits, rationale };
      } catch (e) { res = { applied: 0, errors: [e.message] }; }
      feedback = res.errors;
    }
    results.push({ finding: f.id, ...res, rationale });
  }
  return results;
}
