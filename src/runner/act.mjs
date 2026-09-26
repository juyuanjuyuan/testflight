const KEYMAP = { 'Shift+Tab': 'Shift+Tab', Space: 'Space' }; // Playwright key names

export async function act(page, action) {
  if (action.kind === 'press') await page.keyboard.press(KEYMAP[action.key] || action.key);
  else if (action.kind === 'type') {
    if (action.replace) await page.keyboard.press('ControlOrMeta+A'); // select the field's content so typing overwrites it
    await page.keyboard.type(action.text, { delay: 5 });
  }
}
