import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');

/** Run axe-core on the current page state. Returns [] on CSP/injection failure (real sites). */
export async function runAxe(page) {
  try {
    if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE_PATH });
    const res = await page.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, tags: v.tags, help: v.help,
        nodes: v.nodes.map((n) => ({ target: n.target.map(String) })) }));
    });
    return res;
  } catch (e) {
    return [];
  }
}

/** Merge violations across page states by rule id + target. */
export function mergeAxe(runs) {
  const byKey = new Map();
  for (const v of runs.flat()) {
    for (const n of v.nodes) {
      const k = `${v.id}|${n.target.join(' ')}`;
      if (!byKey.has(k)) byKey.set(k, { ...v, nodes: [n] });
    }
  }
  const byRule = new Map();
  for (const v of byKey.values()) {
    const prev = byRule.get(v.id);
    if (prev) prev.nodes.push(...v.nodes); else byRule.set(v.id, { ...v, nodes: [...v.nodes] });
  }
  return { violations: [...byRule.values()] };
}
