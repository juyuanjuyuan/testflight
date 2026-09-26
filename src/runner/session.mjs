// Browser session. Deterministic: no LLM calls in this file.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { focusInfo, pageText } from './observe.mjs';
import { act } from './act.mjs';
import { runAxe, mergeAxe } from './axe.mjs';
import { CHANGE_WINDOW_MS, SETTLE_MS, BASELINE_MS } from '../contracts.mjs';

const RECORDER = fs.readFileSync(new URL('./recorder.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{url:string, runDir:string, mode?:'local'|'real', cdp?:string, headless?:boolean, axe?:boolean}} o
 */
export async function openSession({ url, runDir, mode = 'local', cdp, headless = true, axe = true }) {
  let browser, page, owned = true;
  if (mode === 'real') {
    browser = await chromium.connectOverCDP(cdp || process.env.CDP_ENDPOINT);
    page = browser.contexts()[0].pages()[0]; // tab the human already opened and cleared captcha/login on
    owned = false;
    await page.context().addInitScript(RECORDER);
    await page.evaluate(RECORDER);
  } else {
    browser = await chromium.launch({ headless, executablePath: process.env.CHROME_BIN || undefined });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(RECORDER);
    page = await ctx.newPage();
  }
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send('Accessibility.enable').catch(() => {});

  let loads = 0;
  page.on('domcontentloaded', () => { loads++; });
  fs.mkdirSync(path.join(runDir, 'shots'), { recursive: true });
  const axeRuns = [];
  let i = 0;
  let current = null;

  async function snapshot(extra) {
    const shot = `shots/${String(i).padStart(4, '0')}.png`;
    await page.screenshot({ path: path.join(runDir, shot) }).catch(() => {});
    return { url: page.url(), title: await page.title(), modalOpen: await page.evaluate(() => window.__a11yRec?.modalOpen() ?? false),
      focusVisible: null, screenshot: shot, ...extra };
  }

  async function settle(loadsBefore) {
    await sleep(SETTLE_MS);
    if (loads !== loadsBefore) await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    const t0 = Date.now();
    while (Date.now() - t0 < CHANGE_WINDOW_MS) {  // until 300ms quiet, capped at the attribution window
      const q = await page.evaluate(() => window.__a11yRec?.quietFor() ?? 1e9).catch(() => 1e9);
      if (q >= SETTLE_MS) break;
      await sleep(100);
    }
  }

  return {
    page,
    async start(goalUrl = url) {
      if (mode !== 'real') await page.goto(goalUrl, { waitUntil: 'load' });
      await sleep(BASELINE_MS); // idle baseline: anything that changes now is noise, not caused by the user
      const focus = await focusInfo(page, cdpSession);
      const step = { i, t: Date.now(), action: { kind: 'start', reason: 'open page' }, focusBefore: null, focusAfter: focus,
        changes: [], spoken: [], pageLoad: true, pageText: await pageText(cdpSession), ...(await snapshot()) };
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
      await settle(loadsBefore);
      const pageLoad = loads !== loadsBefore;
      const changes = pageLoad ? [] : await page.evaluate((w) => window.__a11yRec.collect(w), CHANGE_WINDOW_MS);
      const focusAfter = await focusInfo(page, cdpSession);
      const step = { i, t: Date.now(), action, focusBefore, focusAfter, changes, spoken: [], pageLoad,
        pageText: pageLoad ? await pageText(cdpSession) : null, ...(await snapshot()) };
      if (axe && (pageLoad || changes.length)) axeRuns.push(await runAxe(page));
      current = focusAfter; i++;
      return step;
    },
    axeResults: () => mergeAxe(axeRuns),
    async close() { if (owned) await browser.close(); else await cdpSession.detach().catch(() => {}); },
  };
}
