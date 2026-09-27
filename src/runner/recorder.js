// Injected with page.addInitScript BEFORE page scripts (otherwise init-time changes are missed).
// Plain browser JS, no imports. Exposes window.__a11yRec with mark() / collect() / describeActive() / modalOpen() /
// unreachableClickables() (D6) / focusVisible() (D5).
// Thresholds come from contracts.mjs via window.__A11Y_CONFIG, which session.mjs injects first.
(() => {
  if (window.__a11yRec) return;
  const CFG = window.__A11Y_CONFIG;
  if (!CFG) throw new Error('a11y recorder: window.__A11Y_CONFIG missing (inject it before recorder.js)');
  const { NOISE_GAP_MS } = CFG;
  let lastInputAt = 0;
  let markAt = null;
  let beforeLines = new Set();
  let focusAtMark = null;
  const touched = new Map();          // Element -> first mutation time since mark
  const noise = new WeakMap();        // Element -> mutations with no recent user input
  let lastMutationAt = 0;
  let inAction = false;               // true between mark() and collect()

  addEventListener('keydown', () => { lastInputAt = performance.now(); }, true);
  addEventListener('mousedown', () => { lastInputAt = performance.now(); }, true);
  // attributes of the element at the moment focus arrives, before page handlers add their own focus classes
  // (MUI's Mui-focusVisible, React Aria's data-focus-visible): the D5 probe gets these, or it would copy the focus style
  let focusArrival = null;
  addEventListener('focus', (e) => {
    if (e.target instanceof Element) focusArrival = { el: e.target, attrs: [...e.target.attributes].map((a) => [a.name, a.value]) };
  }, true);

  const elOf = (n) => (n.nodeType === 1 ? n : n.parentElement);
  const lines = (t) => (t || '').split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const PROBE_ATTR = 'data-a11y-probe';
  const isProbe = (m) => m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].every((n) => n.nodeType === 1 && n.hasAttribute(PROBE_ATTR));

  function onMutations(all) {
    const muts = all.filter((m) => !isProbe(m)); // our own D5 probe is not page activity
    if (!muts.length) return;
    const now = performance.now();
    lastMutationAt = now;
    // a mutation is 'unprompted' if no action is in flight, or the last key was long ago
    const quiet = !inAction || now - lastInputAt > NOISE_GAP_MS;
    for (const m of muts) {
      const targets = m.type === 'childList' ? [...m.addedNodes].map(elOf) : [elOf(m.target)];
      for (const el of targets) {
        if (!el || el.closest('script,style,noscript,head')) continue;
        if (quiet) noise.set(el, (noise.get(el) || 0) + 1);
        if (markAt !== null && !touched.has(el)) touched.set(el, now);
      }
    }
  }
  const start = () => new MutationObserver(onMutations).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-expanded'],
  });
  if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start);

  function selectorOf(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    for (let e = el, d = 0; e && e !== document.body && d < 5; e = e.parentElement, d++) {
      if (e.id) { parts.unshift(`#${CSS.escape(e.id)}`); break; }
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      parts.unshift(same.length > 1 ? `${e.tagName.toLowerCase()}:nth-of-type(${same.indexOf(e) + 1})` : e.tagName.toLowerCase());
    }
    return parts.join(' > ');
  }
  const barrierOf = (el) => el?.closest?.('[data-barrier]')?.getAttribute('data-barrier') ?? null;
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  function isVisible(el) {
    if (!el.isConnected) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function liveInfo(el) {
    const lr = el.closest('[aria-live]:not([aria-live="off"]),[role="alert"],[role="status"],[role="log"],output');
    if (!lr) return null;
    const pol = lr.getAttribute('aria-live') || (lr.getAttribute('role') === 'alert' ? 'assertive' : 'polite');
    return pol;
  }
  function referencedBy(el) {
    const out = [];
    for (const r of document.querySelectorAll('[aria-describedby],[aria-errormessage]')) {
      const ids = `${r.getAttribute('aria-describedby') || ''} ${r.getAttribute('aria-errormessage') || ''}`.split(/\s+/).filter(Boolean);
      if (ids.some((id) => { const t = document.getElementById(id); return t && (t === el || t.contains(el)); })) out.push(selectorOf(r));
    }
    return out;
  }
  function noiseOf(el) {
    let n = 0;
    for (let e = el, d = 0; e && d < 4; e = e.parentElement, d++) n = Math.max(n, noise.get(e) || 0);
    return n;
  }
  // deepest descendant whose text still contains the line
  function narrow(el, line) {
    let cur = el;
    for (;;) {
      const child = [...cur.children].find((c) => (c.innerText || '').includes(line));
      if (!child) return cur;
      cur = child;
    }
  }
  // keyboard-reachable = Tab can land on it; tabindex=-1 is focusable by script but never by Tab
  function tabbable(el) {
    if (el.disabled) return false;
    if ((el.tagName === 'A' || el.tagName === 'AREA') && !el.hasAttribute('href') && !el.hasAttribute('tabindex')) return false;
    return el.tabIndex >= 0;
  }
  function looksClickable(el) {
    if (el.hasAttribute('onclick') || typeof el.onclick === 'function') return true;
    if (['button', 'link'].includes(el.getAttribute('role'))) return true;
    // cursor is inherited: only count the element where pointer starts, not every descendant
    return getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer');
  }
  function isActiveBody() {
    const a = document.activeElement;
    return !a || a === document.body || a === document.documentElement;
  }
  // what a sighted keyboard user can see change on focus (D5); outline/border colours only count when drawn
  const edge = (cs, p) => (!['none', 'hidden'].includes(cs[`${p}Style`]) && parseFloat(cs[`${p}Width`]) > 0
    ? `${cs[`${p}Style`]} ${cs[`${p}Width`]} ${cs[`${p}Color`]}` : 'none');
  const look = (cs) => [edge(cs, 'outline'), ...['Top', 'Right', 'Bottom', 'Left'].map((s) => edge(cs, `border${s}`)),
    cs.boxShadow, cs.backgroundColor, cs.backgroundImage, cs.color, cs.textDecorationLine, cs.opacity, cs.transform].join('|');
  const noBox = (cs) => cs.content === 'none' || cs.content === 'normal';
  function looksDifferent(a, b, pseudo) {
    const ca = getComputedStyle(a, pseudo), cb = getComputedStyle(b, pseudo);
    if (pseudo && noBox(ca) && noBox(cb)) return false; // pseudo-element not rendered on either
    return look(ca) + ca.content !== look(cb) + cb.content;
  }

  window.__a11yRec = {
    mark() {
      markAt = performance.now();
      inAction = true;
      touched.clear();
      beforeLines = new Set(lines(document.body?.innerText));
      focusAtMark = document.activeElement;
      return true;
    },
    quietFor() { return performance.now() - lastMutationAt; },
    collect(windowMs = CFG.CHANGE_WINDOW_MS) {
      inAction = false;
      if (markAt === null) return [];
      const byEl = new Map();
      const active = document.activeElement;
      const focusMoved = active !== focusAtMark;
      for (const [el, t] of touched) {
        const dt = Math.round(t - markAt);
        if (dt > windowMs || !isVisible(el)) continue;
        for (const line of lines(el.innerText)) {
          if (beforeLines.has(line)) continue;
          const target = narrow(el, line);
          const prev = byEl.get(target);
          if (prev) { if (!prev.text.includes(line)) prev.text += ' ' + line; continue; }
          const into = focusMoved && active && !isActiveBody() && (active === target || target.contains(active) || active.contains(target));
          byEl.set(target, {
            text: line.slice(0, 300), selector: selectorOf(target), barrierId: barrierOf(target), dtMs: dt,
            visible: true, inLiveRegion: !!liveInfo(target), liveRegion: liveInfo(target),
            referencedBy: referencedBy(target), focusMovedInto: !!into, repeatCount: noiseOf(target), rect: rectOf(target),
          });
        }
      }
      return [...byEl.values()];
    },
    describeActive() {
      const a = document.activeElement;
      const body = isActiveBody();
      return {
        selector: body ? 'body' : selectorOf(a), barrierId: body ? null : barrierOf(a), isBody: body,
        inModal: !body && !!a.closest('dialog[open],[role="dialog"],[role="alertdialog"]'),
        rect: body ? null : rectOf(a),
        inputHints: body ? null : ['type', 'name', 'id', 'autocomplete'].map((k) => a.getAttribute(k) || '').join(' '),
      };
    },
    /** Visible elements that look clickable but Tab can never reach (D6). Called only on a 'stuck' step. */
    unreachableClickables(max) {
      const out = [];
      for (const el of document.body?.querySelectorAll('*') ?? []) {
        if (out.length >= max) break;
        if (el.closest('script,style,noscript,[inert],[aria-hidden="true"]') || !looksClickable(el) || !isVisible(el)) continue;
        // inside something Tab can reach (text inside a button/link): the ancestor is the control
        let reachable = false;
        for (let e = el; e && e !== document.body; e = e.parentElement) if (tabbable(e)) { reachable = true; break; }
        if (reachable || out.some((o) => o.el.contains(el))) continue;
        const text = lines(el.innerText).join(' ') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
        out.push({ el, selector: selectorOf(el), barrierId: barrierOf(el), text: text.slice(0, 120) });
      }
      return out.map(({ el, ...u }) => u);
    },
    modalOpen() {
      return [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]')].some(isVisible);
    },
    /**
     * D5: does the focused element look different from an unfocused copy of itself? The copy sits next to it (same
     * cascade) and is removed in this same task, so it is never painted and can never take focus.
     * null = can't judge from the element's own style: body, focus inside a frame/shadow tree, or an element that is
     * itself invisible (sr-only / opacity:0 inputs whose ring is drawn on a sibling label).
     */
    focusVisible() {
      if (isActiveBody()) return null;
      const el = document.activeElement;
      if (el.shadowRoot || ['IFRAME', 'FRAME', 'OBJECT', 'EMBED'].includes(el.tagName)) return null;
      const r = el.getBoundingClientRect();
      if (!isVisible(el) || r.width <= 1 || r.height <= 1) return null;
      const probe = el.cloneNode(true);
      if (focusArrival?.el === el) {
        for (const { name } of [...probe.attributes]) probe.removeAttribute(name);
        for (const [name, value] of focusArrival.attrs) probe.setAttribute(name, value);
      }
      probe.setAttribute(PROBE_ATTR, '');
      el.after(probe);
      try {
        return [null, '::before', '::after'].some((p) => looksDifferent(el, probe, p));
      } finally {
        probe.remove();
      }
    },
  };
})();
