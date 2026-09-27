// Plan 18: the tasker picks a task when the user gives only a URL. Fake LLM client (no network, no cache), no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Set before llm.mjs loads .env: dotenv never overrides variables that already exist.
process.env.LLM_CACHE = 'off';
process.env.MODEL_JUDGE = 'fake-judge';
process.env.MODEL_PLANNER = 'fake-judge';
const { ROOT } = await import('../src/paths.mjs');
const { MAX_GOAL_CHARS } = await import('../src/contracts.mjs');
const { typedValueInGoal } = await import('../src/agent/planner.mjs');
const { suggestTasks, curatedTasks, checkSuggestion, loadTestData, siteKeyFromUrl, DATA_KINDS, STEP_WORDS } = await import('../src/agent/tasker.mjs');

/** Fake OpenAI client: replies[i] is the JSON object the model "answers" on call i (last one repeats). */
function fakeClient(replies) {
  const calls = [];
  return {
    calls,
    chat: { completions: { create: async (body) => {
      calls.push(body.messages[1].content);
      return { choices: [{ message: { content: JSON.stringify(replies[Math.min(calls.length - 1, replies.length - 1)]) } }] };
    } } },
  };
}
const PAGE = { url: 'http://localhost:8080/shop/fixed/', title: 'Tote Shop', pageText: '[heading] Tote Shop\nCanvas Tote Bag\n$24' };
const good = (goal = 'Buy a canvas tote bag', needs = ['payment_card']) => ({ goal, reason: 'Buying is the main job of a shop', needs });

test('demo site with preset tasks: curated goals from eval/groundtruth, the model is never called', async () => {
  const client = fakeClient([{ suggestions: [good()] }]);
  const r = await suggestTasks({ ...PAGE, url: 'http://localhost:8080/shop/original/', siteKey: 'sites/shop/original', client });
  assert.equal(client.calls.length, 0);
  assert.ok(r.suggestions.length >= 1);
  assert.ok(r.suggestions.every((s) => s.source === 'curated' && s.reason && Array.isArray(s.needs)));
  assert.equal(r.suggestions[0].goal, 'Buy a canvas tote bag. Pay with card 4000 0000 0000 0002; if it is declined, use 4242 4242 4242 4242.');
  assert.equal(r.testDataProfile, null, 'a curated goal carries its own values');
});

test('curated: a preset task tied to a URL (?from=newsletter) comes first only for that URL', () => {
  const popup = curatedTasks('sites/shop/original', 'http://localhost:8080/shop/original/?from=newsletter');
  assert.equal(popup[0].goal, 'Open the Canvas Tote Bag product page');
  const plain = curatedTasks('sites/shop/original', 'http://localhost:8080/shop/original/');
  assert.ok(!plain.some((s) => s.goal === 'Open the Canvas Tote Bag product page'));
  assert.deepEqual(curatedTasks('sites/shop/fixed', PAGE.url), [], 'shop-fixed.yaml has no goal');
  assert.deepEqual(curatedTasks(null, PAGE.url), []);
});

test('generated: suggestions with UI steps or digits are dropped; values come from the site test-data profile', async () => {
  const client = fakeClient([{ suggestions: [
    good('Click the Buy button and pay'), good('Tab to the cart link'), good('Buy 2 canvas tote bags'), good(),
  ] }]);
  const r = await suggestTasks({ ...PAGE, siteKey: 'sites/shop/fixed', client });
  assert.equal(client.calls.length, 1);
  assert.equal(r.suggestions.length, 1);
  const [s] = r.suggestions;
  assert.equal(s.source, 'generated');
  assert.deepEqual(s.needs, ['payment_card']);
  assert.equal(r.testDataProfile, 'shop');
  const { sentences } = loadTestData('sites/shop/fixed');
  assert.equal(s.goal, `Buy a canvas tote bag. ${sentences.payment_card}`);
  // the planner may type exactly the values the goal gives: both cards pass its check, an invented one does not
  assert.ok(typedValueInGoal('4000 0000 0000 0002', s.goal));
  assert.ok(typedValueInGoal('4242 4242 4242 4242', s.goal));
  assert.ok(!typedValueInGoal('5555 5555 5555 4444', s.goal));
});

test('generate: true on a demo site with presets skips them and asks the model; values from the site profile, same checks', async () => {
  const client = fakeClient([{ suggestions: [good('Click the Buy button'), good('Buy 2 bags'), good('Buy a bag', ['ssn']), good()] }]);
  const r = await suggestTasks({ ...PAGE, url: 'http://localhost:8080/shop/original/', siteKey: 'sites/shop/original', generate: true, client });
  assert.equal(client.calls.length, 1);
  assert.equal(r.suggestions.length, 1, 'step words, digits and unknown data kinds are still dropped');
  const [s] = r.suggestions;
  assert.equal(s.source, 'generated');
  assert.equal(r.testDataProfile, 'shop');
  assert.equal(s.goal, `Buy a canvas tote bag. ${JSON.parse(fs.readFileSync(path.join(ROOT, 'config/test-data/shop.json'), 'utf8')).sentences.payment_card}`);
  assert.ok(typedValueInGoal('4000 0000 0000 0002', s.goal));
  assert.ok(typedValueInGoal('4242 4242 4242 4242', s.goal));
  assert.ok(!typedValueInGoal('5555 5555 5555 4444', s.goal));
});

test('generate: false (or left out) keeps the presets, the model is never called', async () => {
  for (const generate of [false, undefined]) {
    const client = fakeClient([{ suggestions: [good()] }]);
    const r = await suggestTasks({ ...PAGE, url: 'http://localhost:8080/shop/original/', siteKey: 'sites/shop/original', generate, client });
    assert.equal(client.calls.length, 0);
    assert.equal(r.suggestions[0].source, 'curated');
  }
});

test('generated: a site without its own profile uses config/test-data/default.json', async () => {
  const client = fakeClient([{ suggestions: [good('Sign up for the newsletter', ['email'])] }]);
  const r = await suggestTasks({ ...PAGE, siteKey: 'sites/testpage/patched', client });
  assert.equal(r.testDataProfile, 'default');
  const { sentences } = loadTestData(null);
  assert.equal(r.suggestions[0].goal, `Sign up for the newsletter. ${sentences.email}`);
});

test('checkSuggestion: step words (whole words, any case), digits, unknown data kinds, length', () => {
  const ok = (goal, needs = []) => checkSuggestion({ goal, reason: 'r', needs });
  assert.equal(ok('Buy a tablet'), null, '"tablet" is not the word "tab"');
  assert.equal(ok('Find the store opening hours'), null);
  for (const w of STEP_WORDS) assert.match(ok(`Buy a bag using the ${w.toUpperCase()}`), /step/i, w);
  assert.match(ok('Open the navigation menus'), /step/i);
  assert.match(ok('Keep tabbing until checkout'), /step/i);
  assert.match(ok('Buy the $24 bag'), /digit/i);
  assert.match(ok('Buy a bag', ['ssn']), /data kind/i);
  assert.match(ok('x'.repeat(MAX_GOAL_CHARS + 1)), /long/i);
  assert.match(checkSuggestion({ goal: 'Buy', needs: [] }), /reason/);
  assert.match(checkSuggestion(null), /object/);
});

test('generated: all invalid → one retry that says why; still invalid → error, never an unchecked goal', async () => {
  const bad = { suggestions: [good('Click Buy')] };
  const fixedOnRetry = fakeClient([bad, { suggestions: [good()] }]);
  const r = await suggestTasks({ ...PAGE, siteKey: 'sites/shop/fixed', client: fixedOnRetry });
  assert.equal(fixedOnRetry.calls.length, 2);
  assert.match(fixedOnRetry.calls[1], /previousReplyWasInvalid/);
  assert.equal(r.suggestions[0].source, 'generated');

  const never = fakeClient([bad, { nope: true }]);
  await assert.rejects(suggestTasks({ ...PAGE, siteKey: 'sites/shop/fixed', client: never }), /no usable task/i);
  assert.equal(never.calls.length, 2);
});

test('generated: at most MAX_SUGGESTIONS, in the model\'s order', async () => {
  const client = fakeClient([{ suggestions: ['Buy a bag', 'Buy a hat', 'Buy a mug', 'Buy a pen'].map((g) => good(g, [])) }]);
  const r = await suggestTasks({ ...PAGE, siteKey: 'sites/shop/fixed', client });
  assert.deepEqual(r.suggestions.map((s) => s.goal), ['Buy a bag.', 'Buy a hat.', 'Buy a mug.']);
});

test('real mode: no payment or personal data in the goal, and it stops before paying', async () => {
  const client = fakeClient([{ suggestions: [good('Buy a canvas tote bag', ['payment_card', 'email', 'name', 'address', 'phone'])] }]);
  const r = await suggestTasks({ ...PAGE, url: 'https://shop.example/', mode: 'real', siteKey: null, client });
  const [s] = r.suggestions;
  assert.equal(r.testDataProfile, null);
  assert.doesNotMatch(s.goal, /\d|@/);
  for (const [, sentence] of Object.entries(loadTestData(null).sentences)) assert.ok(!s.goal.includes(sentence));
  assert.match(s.goal, /before paying/i);
  assert.match(client.calls[0], /"mode":"real"/);
});

test('information barrier: the model sees only url, title and the AX page text (no DOM, screenshot, changes)', async () => {
  const client = fakeClient([{ suggestions: [good()] }]);
  await suggestTasks({ ...PAGE, siteKey: 'sites/shop/fixed', client, changes: [{ text: 'secret' }], screenshot: 'shots/0000.png', html: '<div>' });
  const sent = JSON.parse(client.calls[0]);
  assert.deepEqual(Object.keys(sent).sort(), ['dataKinds', 'maxSuggestions', 'mode', 'pageText', 'title', 'url']);
  assert.equal(sent.pageText, PAGE.pageText);
});

test('siteKeyFromUrl: only this machine\'s demo sites map to sites/<a>/<b>', () => {
  assert.equal(siteKeyFromUrl('http://localhost:8080/shop/original/product.html'), 'sites/shop/original');
  assert.equal(siteKeyFromUrl('http://127.0.0.1:8090/testpage/fixed/'), 'sites/testpage/fixed');
  assert.equal(siteKeyFromUrl('https://shop.example/shop/original/'), null);
  assert.equal(siteKeyFromUrl('http://localhost:8080/nope/x/'), null);
  assert.equal(siteKeyFromUrl('http://localhost:8080/../../etc/'), null);
  assert.equal(siteKeyFromUrl('not a url'), null);
});

test('test-data profiles: every data kind has a sentence; only public test values (test cards, example.com)', () => {
  const dir = path.join(ROOT, 'config/test-data');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.includes('default.json') && files.includes('shop.json'));
  const PUBLIC_CARDS = ['4242 4242 4242 4242', '4000 0000 0000 0002'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const email of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []) assert.match(email, /@example\.(com|org|net)$/, `${f}: ${email}`);
    for (const card of text.match(/\d{4}(?: \d{4}){3}/g) || []) assert.ok(PUBLIC_CARDS.includes(card), `${f}: ${card}`);
  }
  const { sentences } = loadTestData(null);
  for (const k of DATA_KINDS) assert.equal(typeof sentences[k], 'string', k);
});

// ---- audit() without a goal: the task is picked from step 0 (what the planner sees then) ----

const Ajv2020 = (await import('ajv/dist/2020.js')).default;
const addFormats = (await import('ajv-formats')).default;
const os = await import('node:os');
const { readTrace } = await import('../src/contracts.mjs');
const { audit } = await import('../src/audit.mjs');
const { createProgressWriter, readProgress } = await import('../src/report/progress.mjs');
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(readJSON('docs/report.schema.json'));
const validateProgress = ajv.compile(readJSON('docs/progress.schema.json'));
const validateReport = ajv.getSchema(readJSON('docs/report.schema.json').$id);
const trace = readTrace(fs.readFileSync(path.join(ROOT, 'fixtures/testpage-original/trace.jsonl'), 'utf8'));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tasker-'));
function fakeSession() {
  let k = 0;
  return async () => ({ start: async () => trace[k++], step: async () => trace[k++], axeResults: () => ({ violations: [] }), close: async () => {} });
}
/** audit() with progress.json written and validated at every update; returns the states seen and the result. */
async function auditSeen(o) {
  const runDir = tmpDir();
  const write = createProgressWriter(runDir);
  const seen = [];
  const onProgress = (u) => {
    write(u);
    const p = readProgress(runDir);
    assert.ok(validateProgress(p), `${p.state}: ${JSON.stringify(validateProgress.errors)}`);
    seen.push(p);
  };
  const res = await audit({ url: 'http://localhost:8080/testpage/fixed/', runDir, script: trace.slice(1).map((s) => s.action),
    judgeEnabled: false, onProgress, openSession: fakeSession(), ...o }).catch((e) => ({ error: e }));
  return { seen, runDir, ...res };
}
// preset of eval/groundtruth/testpage-fixed.yaml; sites/testpage/patched (the fixer's output) has no preset
const TESTPAGE_GOAL = 'Buy the canvas tote bag. Pay with card number 4242 4242 4242 4242.';
const collapse = (states) => states.filter((s, k) => s !== states[k - 1]);

test('audit() without a goal: planning_task → running → analyzing → done; the curated goal reaches progress and report meta', async () => {
  const { seen, report } = await auditSeen({ site: 'sites/testpage/fixed' });
  assert.deepEqual(collapse(seen.map((p) => p.state)), ['planning_task', 'running', 'analyzing', 'done']);
  assert.ok(seen.filter((p) => p.state === 'planning_task').every((p) => p.goal === null));
  assert.ok(seen.filter((p) => p.state !== 'planning_task').every((p) => p.goal === TESTPAGE_GOAL));
  assert.equal(report.meta.goal, TESTPAGE_GOAL);
  assert.equal(report.meta.goalSource, 'curated');
  assert.equal(typeof report.meta.goalReason, 'string');
  assert.equal(report.meta.testDataProfile, null);
  assert.ok(validateReport(JSON.parse(JSON.stringify(report))), JSON.stringify(validateReport.errors));
});

test('audit() without a goal on a site with no preset: generated goal, source and profile in meta; the tasker saw step 0', async () => {
  const client = fakeClient([{ suggestions: [good()] }]);
  const { report, seen } = await auditSeen({ site: 'sites/testpage/patched', llmClient: client });
  assert.equal(client.calls.length, 1);
  const sent = JSON.parse(client.calls[0]);
  assert.equal(sent.pageText, trace[0].pageText);
  assert.equal(sent.title, trace[0].title);
  assert.equal(report.meta.goalSource, 'generated');
  assert.equal(report.meta.goalReason, good().reason);
  assert.equal(report.meta.testDataProfile, 'default');
  assert.equal(report.meta.goal, `Buy a canvas tote bag. ${loadTestData(null).sentences.payment_card}`);
  assert.equal(seen.at(-1).goal, report.meta.goal);
  assert.ok(validateReport(JSON.parse(JSON.stringify(report))), JSON.stringify(validateReport.errors));
});

test('audit() without a goal: no usable task → failed with a readable one-line error, rethrown', async () => {
  const client = fakeClient([{ suggestions: [good('Click Buy')] }]);
  const { seen, error } = await auditSeen({ site: 'sites/testpage/patched', llmClient: client });
  assert.match(error.message, /Could not work out a task for this page/);
  const last = seen.at(-1);
  assert.equal(last.state, 'failed');
  assert.match(last.error, /^Could not work out a task for this page\. Please describe one\./);
  assert.ok(!last.error.includes('\n'));
  assert.equal(last.goal, null);
});

test('audit() with a goal: meta.goalSource is user and the tasker is not involved', async () => {
  const client = fakeClient([{ suggestions: [good()] }]);
  const { seen, report } = await auditSeen({ goal: 'Buy the canvas tote bag', site: 'sites/testpage/original', llmClient: client });
  assert.equal(client.calls.length, 0);
  assert.ok(!seen.some((p) => p.state === 'planning_task'));
  assert.equal(report.meta.goalSource, 'user');
  assert.equal(report.meta.goalReason, null);
});
