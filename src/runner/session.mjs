// Browser session. Deterministic: no LLM calls in this file.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { focusInfo, pageText } from './observe.mjs';
import { act, helperClick } from './act.mjs';
import { CLOSE_RE } from '../detect/util.mjs';
import { redactFocusValue, redactSpoken } from './guard.mjs';
import { runAxe, mergeAxe } from './axe.mjs';
import { vsrScript, startVsr, readVsr, stopVsr } from './vsr.mjs';
import { CHANGE_WINDOW_MS, SETTLE_MS, BASELINE_MS, LOAD_TIMEOUT_MS, SPOKEN_SOURCE } from '../contracts.mjs';

const RECORDER = fs.readFileSync(new URL('./recorder.js', import.meta.url), 'utf8');
/** Thresholds the in-page recorder needs; injected as window.__A11Y_CONFIG before recorder.js runs. */
export const RECORDER_CONFIG = { CHANGE_WINDOW_MS, NOISE_GAP_MS: CHANGE_WINDOW_MS };
// cap on D6 candidates per stuck step: real sites have many cursor:pointer cards, the judge filters the rest
const MAX_UNREACHABLE = 20;
const MAX_FIELDS = 200; // field values checked when masking what the virtual screen reader said
const CONFIG_SCRIPT = `window.__A11Y_CONFIG = ${JSON.stringify(RECORDER_CONFIG)};`;
const TRACE_FILE = 'trace.zip';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Enable the CDP accessibility domain; without it every focus read is wrong, so fail loudly. */
export async function enableAX(cdp) {
  try { await cdp.send('Accessibility.enable'); } catch (e) { throw new Error(`CDP Accessibility.enable failed: ${e.message}`); }
}

/** Screenshot to runDir/rel. Returns rel, or null if it failed (the step records screenshot: null). */
export async function screenshotOrNull(page, runDir, rel) {
  try { await page.screenshot({ path: path.join(runDir, rel) }); return rel; } catch { return null; }
}

/** Pixel size {w, h} of a PNG file, read from its IHDR header (screenshots differ in size in real mode). */
export function pngSize(file) {
  const buf = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, 24, 0); } finally { fs.closeSync(fd); }
  if (buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error(`not a PNG: ${file}`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Real mode: the tab the human is looking at (first visible one), else the first tab. */
export async function pickTab(browser) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  if (!pages.length) throw new Error('real mode: the attached Chrome has no open tab; open the site first (scripts/real-chrome.sh <url>)');
  // a tab that cannot run script (crashed, chrome:// page) is simply not a candidate; the chosen URL is recorded as meta.url
  const visible = await Promise.all(pages.map((p) => p.evaluate(() => document.visibilityState === 'visible').catch(() => false)));
  return pages[visible.indexOf(true)] ?? pages[0];
}

async function connectReal(browserType, cdp) {
  const endpoint = cdp || process.env.CDP_ENDPOINT;
  if (!endpoint) throw new Error('real mode needs --cdp http://localhost:9222 (or CDP_ENDPOINT in .env); start Chrome with scripts/real-chrome.sh');
  try { return await browserType.connectOverCDP(endpoint); } catch (e) {
    throw new Error(`cannot attach to Chrome at ${endpoint} (is scripts/real-chrome.sh running?): ${e.message.split('\n')[0]}`);
  }
}

/** Wait for 'load' after a navigation. A timeout is recorded as loadTimeout; any other error propagates. */
export async function waitForLoad(page) {
  try { await page.waitForLoadState('load', { timeout: LOAD_TIMEOUT_MS }); return { loadTimeout: false }; } catch (e) {
    if (e.name === 'TimeoutError') return { loadTimeout: true };
    throw e;
  }
}

// --trace is a debugging aid: when Playwright cannot trace (e.g. the human's Chrome over CDP) the run goes on
// and the reason ends up in meta.json as traceError.
async function startTrace(ctx) {
  try { await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false }); return { trace: TRACE_FILE }; } catch (e) {
    return { traceError: `trace not started: ${e.message.split('\n')[0]}` };
  }
}

async function stopTrace(ctx, runDir) {
  try { await ctx.tracing.stop({ path: path.join(runDir, TRACE_FILE) }); return { trace: TRACE_FILE }; } catch (e) {
    return { traceError: `trace not saved: ${e.message.split('\n')[0]}` };
  }
}

/**
 * Real mode attaches to the human's Chrome: with `url` it navigates the visible tab there first; then it awaits
 * waitForUser (human clears captcha/login, nothing is recorded meanwhile) and, without `url`, takes the tab visible then.
 * trace: record a Playwright trace (after waitForUser) to runDir/trace.zip; close() returns {trace:'trace.zip'} or
 * {traceError} ({} without trace). browserType replaces playwright's chromium (tests only).
 * @param {{url?:string, runDir:string, mode?:'local'|'real', cdp?:string, headless?:boolean, axe?:boolean, trace?:boolean,
 *          waitForUser?:()=>Promise<void>, browserType?:object}} o
 */
export async function openSession({ url, runDir, mode = 'local', cdp, headless = true, axe = true, trace = false, waitForUser, browserType = chromium }) {
  vsrScript(); // a missing or reshaped screen-reader bundle is a setup error: fail before touching the browser
  let browser, page, owned = true;
  if (mode === 'real') {
    browser = await connectReal(browserType, cdp);
    owned = false;
    if (url) { page = await pickTab(browser); await page.goto(url, { waitUntil: 'load' }); }
    await waitForUser?.();
    if (!url) page = await pickTab(browser);
    await page.context().addInitScript(CONFIG_SCRIPT);
    await page.context().addInitScript(RECORDER);
    await page.evaluate(CONFIG_SCRIPT);
    await page.evaluate(RECORDER);
  } else {
    browser = await browserType.launch({ headless, executablePath: process.env.CHROME_BIN || undefined });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(CONFIG_SCRIPT);
    await ctx.addInitScript(RECORDER);
    page = await ctx.newPage();
  }
  let traced = trace ? await startTrace(page.context()) : {};
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

  // virtual screen reader: (re)started in every new document; a document it failed to start in is not retried each step
  let vsrDoc = { loads: -1, error: null };
  async function ensureVsr() { // true = (re)started now, its log begins at 0
    if ((vsrDoc.loads === loads && vsrDoc.error) || (await readVsr(page)) !== null) return false;
    vsrDoc = { loads, error: await startVsr(page) };
    return true;
  }
  /** What it said after its first `before` phrases in this document, masked (redactSpoken); spokenError when not running. */
  async function spokenSince(before) {
    if (await ensureVsr()) before = 0;
    const log = await readVsr(page);
    if (log === null) return { spoken: [], spokenSource: null, spokenError: vsrDoc.error ?? 'virtual screen reader is not running in this page' };
    const fields = await page.evaluate((max) => window.__a11yRec?.fieldValues(max) ?? [], MAX_FIELDS);
    return { spoken: redactSpoken(log.slice(before ?? 0), fields, { mode, typedSelectors }), spokenSource: SPOKEN_SOURCE };
  }

  async function snapshot(extra) {
    const shot = await screenshotOrNull(page, runDir, `shots/${String(i).padStart(4, '0')}.png`);
    const { modalOpen, focusVisible, dpr } = await page.evaluate(() => ({ modalOpen: window.__a11yRec?.modalOpen() ?? false,
      focusVisible: window.__a11yRec?.focusVisible() ?? null, dpr: window.devicePixelRatio })); // null = recorder missing → not checked
    const shotSize = shot ? { shotSize: { ...pngSize(path.join(runDir, shot)), dpr } } : {}; // real mode: window size and DPR are the human's
    return { url: page.url(), title: await page.title(), modalOpen, focusVisible, screenshot: shot, ...shotSize, ...extra };
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
      await ensureVsr(); // listening through the baseline: what the page announces on load is part of step 0
      await sleep(BASELINE_MS); // idle baseline: anything that changes now is noise, not caused by the user
      const focus = await observeFocus();
      const step = { i, t: Date.now(), action: { kind: 'start', reason: 'open page' }, focusBefore: null, focusAfter: focus,
        changes: [], ...(await spokenSince(0)), pageLoad: true, pageText: await pageText(cdpSession, undefined, { redactFieldText: mode === 'real' }), ...(await snapshot()) };
      if (axe) axeRuns.push(await runAxe(page));
      current = focus; i++;
      return step;
    },
    /** Execute one action and record everything deterministically. */
    async step(action) {
      const focusBefore = current;
      const loadsBefore = loads;
      const saidBefore = await page.evaluate(async () => { window.__a11yRec?.mark(); return window.__vsrReady ? (await window.__vsrModule.virtual.spokenPhraseLog()).length : null; });
      if (action.kind === 'press' || action.kind === 'type') await act(page, action);
      const assistError = action.kind === 'assist' ? await helperClick(page, action.target) : null;
      const loadTimeout = await settle(loadsBefore);
      const pageLoad = loads !== loadsBefore;
      const changes = pageLoad ? [] : await page.evaluate((w) => window.__a11yRec.collect(w), CHANGE_WINDOW_MS);
      if (pageLoad) typedSelectors.clear(); // same selector on a new page is a different field, possibly autofilled
      else if (action.kind === 'type' && focusBefore && !focusBefore.isBody) typedSelectors.add(focusBefore.selector);
      const focusAfter = await observeFocus();
      // D6 scan only when stuck: it explains why, and scanning every step would flood real sites with pointer cards
      const unreachable = action.kind === 'stuck' ? { unreachableClickables: await page.evaluate((max) => window.__a11yRec.unreachableClickables(max), MAX_UNREACHABLE) } : {};
      const step = { i, t: Date.now(), action, focusBefore, focusAfter, changes, ...(await spokenSince(saidBefore)), pageLoad, ...unreachable,
        pageText: pageLoad ? await pageText(cdpSession, undefined, { redactFieldText: mode === 'real' }) : null, ...(loadTimeout ? { loadTimeout } : {}),
        ...(assistError ? { assistError } : {}), ...(await snapshot()) };
      if (axe && (pageLoad || changes.length)) axeRuns.push(await runAxe(page));
      current = focusAfter; i++;
      return step;
    },
    /** Assist: {selector, barrierId, text} of the visible Close/× control in the dialog holding fromSelector, or null. */
    mouseExit: (fromSelector) => page.evaluate(([sel, src, flags]) => window.__a11yRec.mouseExit(sel, new RegExp(src, flags)),
      [fromSelector, CLOSE_RE.source, CLOSE_RE.flags]),
    axeResults: () => mergeAxe(axeRuns),
    async close() {
      if (traced.trace) traced = await stopTrace(page.context(), runDir); // before close: the zip is written by this browser connection
      if (!owned) await stopVsr(page).catch(() => {}); // cleanup only, as below: the run is recorded; the tab may be closed or navigated away
      if (!owned) await cdpSession.detach().catch(() => {}); // cleanup only: the run is already recorded, and a tab the human closed can't be detached
      await browser.close(); // real mode: only drops our CDP connection, the human's Chrome and tabs stay open
      return traced;
    },
  };
}
