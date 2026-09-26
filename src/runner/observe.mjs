// Focus + page text from the ACCESSIBILITY TREE via CDP (what assistive tech actually sees).
// Lesson from the feasibility script: do NOT take the node with `focused` from the full tree (returns the root);
// resolve document.activeElement -> DOM.describeNode -> Accessibility.getPartialAXTree.
const val = (p) => (p && p.value != null ? String(p.value) : '');

export async function focusInfo(page, cdp) {
  const dom = await page.evaluate(() => window.__a11yRec?.describeActive() ?? null);
  if (!dom || dom.isBody) return { role: 'body', name: '', description: '', selector: 'body', barrierId: null, isBody: true, inModal: false, rect: null };
  let role = '', name = '', description = '', axError;
  try {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.activeElement', objectGroup: 'a11y-focus' });
    const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false });
    const ax = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId) || nodes[0];
    role = val(ax?.role); name = val(ax?.name); description = val(ax?.description);
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'a11y-focus' });
  } catch (e) {
    role = 'unknown';
    axError = e.message; // kept in the trace so a bad run is diagnosable
  }
  return { role, name, description, ...dom, ...(axError ? { axError } : {}) };
}

const PAGE_ROLES = new Set(['heading', 'link', 'button', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'img',
  'StaticText', 'alert', 'status', 'dialog', 'listitem', 'cell', 'tab', 'option', 'banner', 'main', 'navigation', 'contentinfo']);

/** What a screen-reader user could read on the page (browse mode). Text in images is absent by construction. */
export async function pageText(cdp, maxChars = 4000) {
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const out = [];
  let len = 0;
  for (const n of nodes) {
    if (n.ignored) continue;
    const role = val(n.role), name = val(n.name).replace(/\s+/g, ' ').trim();
    if (!PAGE_ROLES.has(role) || !name) continue;
    const line = role === 'StaticText' ? name : `[${role}] ${name}`;
    if (out[out.length - 1] === line) continue;
    out.push(line);
    len += line.length + 1;
    if (len > maxChars) { out.push('…'); break; }
  }
  return out.join('\n');
}
