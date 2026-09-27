// Guidepup Virtual Screen Reader (@guidepup/virtual-screen-reader, MIT) running inside the audited page. It follows real
// keyboard focus and live regions; what it says becomes step.spoken. Deterministic: no LLM calls in this file.
//
// Injected with page.evaluate like the real-mode recorder: DevTools evaluation is not subject to the site's CSP, needs no
// request routing (routing would disable the HTTP cache of the human's tab in real mode) and no mixed-content exception.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { VSR_START_TIMEOUT_MS } from '../contracts.mjs';

const EXPORTS = /export\s*\{([^}]*)\}\s*;?/g;
let script = null;

/**
 * The package's self-contained browser ESM bundle (no imports of its own) as a classic script: its single
 * `export {a as virtual, …}` becomes `window.__vsrModule = {virtual: a, …}`. Any other bundle shape is a hard error.
 */
export function vsrScript() {
  if (script) return script;
  const file = createRequire(import.meta.url).resolve('@guidepup/virtual-screen-reader/browser.js');
  const src = fs.readFileSync(file, 'utf8');
  const found = src.match(EXPORTS) || [];
  if (found.length !== 1) throw new Error(`virtual screen reader: expected one export statement in ${file}, found ${found.length} (package updated?)`);
  const exported = src.replace(EXPORTS, (all, list) => `window.__vsrModule = {${list.split(',')
    .map((p) => { const [local, as = local] = p.trim().split(/\s+as\s+/); return `${as}: ${local}`; }).join(', ')}};`);
  script = `(() => { "use strict";\n${exported}\n})();`;
  return script;
}

function withTimeout(p, ms, what) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} took over ${ms}ms`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Start it in the current document. Returns null, or why it could not start: the caller records that as spokenError. */
export async function startVsr(page) {
  try {
    await withTimeout((async () => {
      await page.evaluate(vsrScript());
      await page.evaluate(async () => { await window.__vsrModule.virtual.start({ container: document.body }); window.__vsrReady = true; });
    })(), VSR_START_TIMEOUT_MS, 'start');
    return null;
  } catch (e) {
    return `virtual screen reader did not start: ${e.message.split('\n')[0]}`;
  }
}

/** Everything it said in the current document so far, or null when it is not running here (new document, never started). */
export const readVsr = (page) => page.evaluate(() => (window.__vsrReady ? window.__vsrModule.virtual.spokenPhraseLog() : null));

/** Real mode: stop it so nothing of ours keeps running in the human's tab. */
export const stopVsr = (page) => page.evaluate(async () => { if (window.__vsrReady) { window.__vsrReady = false; await window.__vsrModule.virtual.stop(); } });
