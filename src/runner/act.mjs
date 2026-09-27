import { ASSIST_CLICK_TIMEOUT_MS } from '../contracts.mjs';

const KEYMAP = { 'Shift+Tab': 'Shift+Tab', Space: 'Space' }; // Playwright key names

/** The helper's mouse click for an assist step. Returns null, or why it failed (recorded as step.assistError). */
export async function helperClick(page, target) {
  try { await page.click(target, { timeout: ASSIST_CLICK_TIMEOUT_MS }); return null; } catch (e) {
    return `helper could not click ${target}: ${e.message.split('\n')[0]}`;
  }
}

export async function act(page, action) {
  if (action.kind === 'press') await page.keyboard.press(KEYMAP[action.key] || action.key);
  else if (action.kind === 'type') {
    if (action.replace) await page.keyboard.press('ControlOrMeta+A'); // select the field's content so typing overwrites it
    await page.keyboard.type(action.text, { delay: 5 });
  }
}
