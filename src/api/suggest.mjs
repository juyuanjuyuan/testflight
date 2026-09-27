// Task suggestions for a URL without an audit run (POST /api/tasks/suggest, `cli.mjs suggest`).
// The model sees only what the planner would at step 0: url, title and the AX page text; no screenshot, no DOM.
import { chromium } from 'playwright';
import { enableAX } from '../runner/session.mjs';
import { pageText } from '../runner/observe.mjs';
import { curatedTasks, suggestTasks } from '../agent/tasker.mjs';
import { LOAD_TIMEOUT_MS, SETTLE_MS } from '../contracts.mjs';

/** Open url headless and return {url, title, pageText} of the loaded page (the browser is always closed). */
export async function readStartPage(url) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
    const cdp = await page.context().newCDPSession(page);
    await enableAX(cdp);
    return { url: page.url(), title: await page.title(), pageText: await pageText(cdp) };
  } finally {
    await browser.close();
  }
}

/**
 * Suggestions for a local demo site: its presets if it has any (no browser, no model), else read the page and ask the tasker.
 * @param {{url:string, siteKey:string|null, log?:(msg:string)=>void}} o
 */
export async function suggestForUrl({ url, siteKey, log = () => {} }) {
  const curated = curatedTasks(siteKey, url);
  if (curated.length) return { suggestions: curated, testDataProfile: null };
  const page = await readStartPage(url);
  log(`suggest: read ${page.url} (${page.pageText.length} chars of page text)`);
  return suggestTasks({ ...page, url, siteKey });
}
