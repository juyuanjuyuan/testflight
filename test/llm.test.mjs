// chatJSON retry/fallback bookkeeping with a fake client (no network, no cache).
import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';

// Set before llm.mjs loads .env: dotenv never overrides variables that already exist.
process.env.LLM_CACHE = 'off';
process.env.MODEL_PLANNER = 'same-model';
process.env.MODEL_JUDGE = 'same-model';
const { chatJSON } = await import('../src/agent/llm.mjs');
const { LLM_TIMEOUT_MS } = await import('../src/contracts.mjs');

/** Fake OpenAI client: replies[i] is an Error to throw or a string to return as message content. */
function fakeClient(replies) {
  const calls = [];
  return {
    calls,
    chat: { completions: { create: async (body, opts) => {
      calls.push({ model: body.model, timeout: opts.timeout });
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (r instanceof Error) throw r;
      return { choices: [{ message: { content: r } }] };
    } } },
  };
}
const ask = (client, stats, role = 'planner') => chatJSON({ role, system: 's', user: 'u', stats, client });

test('LLM timeouts are the contract constants: planner 8 s, judge and fixer 60 s', () => {
  assert.equal(LLM_TIMEOUT_MS.planner, 8_000);
  assert.equal(LLM_TIMEOUT_MS.judge, 60_000);
  assert.equal(LLM_TIMEOUT_MS.fixer, 60_000);
});

test('every failed attempt is recorded in stats, timeouts included', async () => {
  const client = fakeClient([new OpenAI.APIConnectionTimeoutError(), '{"ok":true}']);
  const stats = {};
  const { data } = await ask(client, stats);
  assert.deepEqual(data, { ok: true });
  assert.equal(client.calls[0].timeout, LLM_TIMEOUT_MS.planner);
  assert.equal(stats.calls, 1, 'calls still counts successful calls only');
  assert.equal(stats.llmAttempts, 2);
  assert.equal(stats.llmFailures, 1);
  assert.equal(stats.llmTimeouts, 1);
  assert.deepEqual(stats.llmErrorTypes, { timeout: 1 });
  assert.equal(typeof stats.llmFailedMs, 'number');
});

test('error types are classified (timeout / parse)', async () => {
  const stats = {};
  await assert.rejects(ask(fakeClient([new OpenAI.APIConnectionTimeoutError(), 'not json']), stats));
  assert.deepEqual(stats.llmErrorTypes, { timeout: 1, parse: 1 });
  assert.equal(stats.llmFailures, 2);
  assert.equal(stats.llmTimeouts, 1);
});

test('the same model configured for planner and judge is not tried twice as a fallback', async () => {
  const client = fakeClient([new OpenAI.APIConnectionTimeoutError()]);
  const stats = {};
  await assert.rejects(ask(client, stats), OpenAI.APIConnectionTimeoutError);
  assert.deepEqual(client.calls.map((c) => c.model), ['same-model', 'same-model'], '2 attempts on one model, no duplicate fallback');
  assert.equal(stats.llmTimeouts, 2);
});

test('judge uses the 60 s timeout', async () => {
  const client = fakeClient(['{"ok":true}']);
  await ask(client, {}, 'judge');
  assert.equal(client.calls[0].timeout, LLM_TIMEOUT_MS.judge);
});
