// Browser session. Deterministic: no LLM calls in this file.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { focusInfo, pageText } from './observe.mjs';
import { act } from './act.mjs';
import { redactFocusValue } from './guard.mjs';
import { runAxe, mergeAxe } from './axe.mjs';
import { CHANGE_WINDOW_MS, SETTLE_MS, BASELINE_MS, LOAD_TIMEOUT_MS, MAX_UNREACHABLE } from '../contracts.mjs';

const RECORDER = fs.readFileSync(new URL('./recorder.js', import.meta.url), 'utf8');
/** Thresholds the in-page recorder needs; injected as window.__A11Y_CONFIG before recorder.js runs. */
export const RECORDER_CONFIG = { CHANGE_WINDOW_MS, NOISE_GAP_MS: CHANGE_WINDOW_MS, MAX_UNREACHABLE };
const CONFIG_SCRIPT = `window.__A11Y_CONFIG = ${JSON.stringify(RECORDER_CONFIG)};`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Enable the CDP accessibility domain; without it every focus read is wrong, so fail loudly. */
export async function enableAX(cdp) {
  try { await cdp.send('Accessibility.enable'); } catch (e) { throw new Error(`CDP Accessibility.enable failed: ${e.message}`); }
}

/** Screenshot to runDir/rel. Returns rel, or null if it failed (the step records screenshot: null). */
export async function screenshotOrNull(page, runDir, rel) {
  try { await page.screenshot({ path: path.join(runDir, rel) }); return rel; } catch { return null; }
}

/** Wait for 'load' after a navigation. A timeout is recorded as loadTimeout; any other error propagates. */
export async function waitForLoad(page) {
  try { await page.waitForLoadState('load', { timeout: LOAD_TIMEOUT_MS }); return { loadTimeout: false }; } catch (e) {
    if (e.name === 'TimeoutError') return { loadTimeout: true };
    throw e;
  }
}

/**
 * @param {{url:string, runDir:string, mode?:'local'|'real', cdp?:string, headless?:boolean, axe?:boolean}} o
 */
export async function openSession({ url, runDir, mode = 'local', cdp, headless = true, axe = true }) {
  let browser, page, owned = true;
  if (mode === 'real') {
    browser = await chromium.connectOverCDP(cdp || process.env.CDP_ENDPOINT);
    page = browser.contexts()[0].pages()[0]; // tab the human already opened and cleared captcha/login on
    owned = false;
    await page.context().addInitScript(CONFIG_SCRIPT);
    await page.context().addInitScript(RECORDER);
    await page.evaluate(CONFIG_SCRIPT);
    await page.evaluate(RECORDER);
  } else {
    browser = await chromium.launch({ headless, executablePath: process.env.CHROME_BIN || undefined });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(CONFIG_SCRIPT);
    await ctx.addInitScript(RECORDER);
    page = await ctx.newPage();
  }
  const cdpSession = await page.context().newCDPSession(page);
  await enableAX(cdpSession);

  let loads = 0;
  page.on('domcontentloaded', () => { loads++; });
  fs.mkdirSync(path.join(runDir, 'shots'), { recursive: true });
  const axeRuns = [];
  let i = 0;
  let current = null;
  const typedSelectors = new Set(); // fields the planner typed into since the last page load (real-mode value redaction)
  const observeFocus = async () => redactFocusValue(await focusInfo(page, cdpSession), { mode, typedSelectors });

  async function snapshot(extra) {
    const shot = await screenshotOrNull(page, runDir, `shots/${String(i).padStart(4, '0')}.png`);
    return { url: page.url(), title: await page.title(), modalOpen: await page.evaluate(() => window.__a11yRec?.modalOpen() ?? false),
      focusVisible: null, screenshot: shot, ...extra };
  }

  async function settle(loadsBefore) {
    await sleep(SETTLE_MS);
    const { loadTimeout } = loads !== loadsBefore ? await waitForLoad(page) : { loadTimeout: false };
    const t0 = Date.now();
    while (Date.now() - t0 < CHANGE_WINDOW_MS) {  // until 300ms quiet, capped at the attribution window
      // evaluate throws when a navigation destroys the context mid-poll: treat as quiet, the step records pageLoad anyway
      const q = await page.evaluate(() => window.__a11yRec?.quietFor() ?? 1e9).catch(() => 1e9);
      if (q >= SETTLE_MS) break;
      await sleep(100);
    }
    return loadTimeout;
  }

  return {
    page,
    async start(goalUrl = url) {
      if (mode !== 'real') await page.goto(goalUrl, { waitUntil: 'load' });
      await sleep(BASELINE_MS); // idle baseline: anything that changes now is noise, not caused by the user
      const focus = await observeFocus();
      const step = { i, t: Date.now(), action: { kind: 'start', reason: 'open page' }, focusBefore: null, focusAfter: focus,
        changes: [], spoken: [], pageLoad: true, pageText: await pageText(cdpSession, undefined, { redactFieldText: mode === 'real' }), ...(await snapshot()) };
      if (axe) axeRuns.push(await runAxe(page));
      current = focus; i++;
      return step;
    },
    /** Execute one action and record everything deterministically. */
    async step(action) {
      const focusBefore = current;
      const loadsBefore = loads;
      await page.evaluate(() => window.__a11yRec?.mark());
      if (action.kind === 'press' || action.kind === 'type') await act(page, action);
      const loadTimeout = await settle(loadsBefore);
      const pageLoad = loads !== loadsBefore;
      const changes = pageLoad ? [] : await page.evaluate((w) => window.__a11yRec.collect(w), CHANGE_WINDOW_MS);
      if (pageLoad) typedSelectors.clear(); // same selector on a new page is a different field, possibly autofilled
      else if (action.kind === 'type' && focusBefore && !focusBefore.isBody) typedSelectors.add(focusBefore.selector);
      const focusAfter = await observeFocus();
      // D6 scan only when stuck: it explains why, and scanning every step would flood real sites with pointer cards
      const unreachable = action.kind === 'stuck' ? { unreachableClickables: await page.evaluate(() => window.__a11yRec.unreachableClickables()) } : {};
      const step = { i, t: Date.now(), action, focusBefore, focusAfter, changes, spoken: [], pageLoad, ...unreachable,
        pageText: pageLoad ? await pageText(cdpSession, undefined, { redactFieldText: mode === 'real' }) : null, ...(loadTimeout ? { loadTimeout } : {}), ...(await snapshot()) };
      if (axe && (pageLoad || changes.length)) axeRuns.push(await runAxe(page));
      current = focusAfter; i++;
      return step;
    },
    axeResults: () => mergeAxe(axeRuns),
    async close() { if (owned) await browser.close(); else await cdpSession.detach().catch(() => {}); }, // cleanup only: the run is already recorded, and a tab the human closed can't be detached
  };
}
