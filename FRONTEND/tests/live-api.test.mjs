import test from "node:test";
import assert from "node:assert/strict";
import { liveApi, ApiError, artifactUrl, rerunName, suggestTasks } from "../src/api/live.ts";
import { frameGeometry, stateLabel, isActive, suggestionLabel, canFix, auditDuration, validateProgress } from "../src/lib/audit.ts";

function mockFetch(t, data, status = 200) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify(data), { status });
  });
  return calls;
}
test("optional task is omitted, while confirmed tasks are trimmed", async (t) => {
  const calls = mockFetch(t, { runDir: "run-1" });
  await liveApi.start(" http://localhost:8080/shop/original/ ", "  ");
  await liveApi.start("http://localhost:8080/shop/original/", " Buy shoes ");
  assert.deepEqual(JSON.parse(calls[0].body), { url: "http://localhost:8080/shop/original/" });
  assert.equal(JSON.parse(calls[1].body).goal, "Buy shoes");
});
test("default repair fixes all blockers and requests a re-test", async (t) => {
  const calls = mockFetch(t, { runDir: "run-1" });
  await liveApi.fix("run-1");
  await liveApi.fix("run-1", ["F2"]);
  assert.equal(calls[0].url, "/api/runs/run-1/fix");
  assert.deepEqual(JSON.parse(calls[0].body), { rerun: true });
  assert.deepEqual(JSON.parse(calls[1].body), { rerun: true, findingIds: ["F2"] });
});
test("task suggestions ask the model even for demo sites with presets", async (t) => {
  const calls = mockFetch(t, { suggestions: [] });
  await liveApi.suggest(" http://localhost:8080/shop/original/ ");
  assert.equal(calls[0].url, "/api/tasks/suggest");
  assert.deepEqual(JSON.parse(calls[0].body), { url: "http://localhost:8080/shop/original/", generate: true });
});
test("suggestion errors preserve backend code and English message", async (t) => {
  mockFetch(t, { error: { code: "suggest_timeout", message: "Task suggestion timed out." } }, 504);
  await assert.rejects(liveApi.suggest("http://localhost:8080/shop/original/"), e =>
    e instanceof ApiError && e.code === "suggest_timeout" && e.status === 504 && e.message === "Task suggestion timed out.");
});
test("nested real runs and rerun references retain correct artifact paths", async (t) => {
  const calls = mockFetch(t, {});
  await liveApi.report("real/run-2");
  assert.equal(calls[0].url, "/runs/real/run-2/report.json");
  assert.equal(rerunName("runs/run-2"), "run-2");
  assert.equal(artifactUrl("real/run-2", "shots/0007.png"), "/runs/real/run-2/shots/0007.png");
  assert.equal(artifactUrl("run-2", "../secret"), undefined);
  assert.throws(() => rerunName("runs/../secret"));
});
test("requests propagate cancellation without converting it to network failure", async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, "fetch", async (_, options) => {
    assert.equal(options.signal, controller.signal);
    throw new DOMException("Aborted", "AbortError");
  });
  await assert.rejects(liveApi.list(controller.signal), { name: "AbortError" });
});
test("network failures produce an actionable error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(liveApi.list(), e => e.code === "network_error" && /backend is running/.test(e.message));
});
test("history preserves unknown status, unavailable verdict and future skip reasons", async (t) => {
  const response = { runs: [{ runDir: "real/run-2", goal: null, state: "future", screenReaderUserCanComplete: null, progress: "corrupt" }], skipped: 1, skippedReasons: { future_reason: 1 } };
  mockFetch(t, response);
  assert.deepEqual(await liveApi.list(), response);
  assert.equal(stateLabel("unknown"), "Status unavailable");
  assert.equal(stateLabel("planning_task"), "Choosing a task…");
});
test("unrecognized progress states read as processing and keep the run active", () => {
  assert.equal(stateLabel("future"), "Processing…");
  assert.equal(isActive("future"), true);
  for (const state of ["done", "failed", "unknown"]) assert.equal(isActive(state), false);
});
test("screenshot focus coordinates account for pixel ratio", () => {
  assert.deepEqual(frameGeometry({ x: 100, y: 50, w: 200, h: 100 }, { w: 2000, h: 1000, dpr: 2 }).focusBox, [.1, .1, .2, .2]);
  assert.deepEqual(frameGeometry().viewport, { width: 1280, height: 800 });
});
test("only original local reports offer repairs", () => {
  assert.equal(canFix({ meta: { mode: "local", site: "sites/shop/original" } }), true);
  assert.equal(canFix({ meta: { mode: "local", site: "sites/shop/patched" } }), false);
  assert.equal(canFix({ meta: { mode: "real", site: null } }), false);
});
test("progress uses backend step limits and unknown states without coercion", () => {
  const progress = { state: "future_state", step: null, maxSteps: 73, timeline: [] };
  assert.equal(validateProgress(progress), progress);
  assert.throws(() => validateProgress({ state: "running" }));
  assert.equal(auditDuration({ meta: {} }), null);
});
test("new audits do not request reports until complete; repairs and legacy runs can load reports", async () => {
  const { shouldLoadReport } = await import("../src/lib/audit.ts");
  for (const state of ["planning_task", "running", "analyzing"]) assert.equal(shouldLoadReport({ state }, false), false);
  for (const state of ["done", "failed", "fixing", "rerunning"]) assert.equal(shouldLoadReport({ state }, false), true);
  assert.equal(shouldLoadReport(null, false), true);
  assert.equal(shouldLoadReport({ state: "fixing" }, true), false);
  assert.equal(shouldLoadReport({ state: "done" }, true), true);
});

const preset = { goal: "Buy a canvas tote bag.", source: "curated", reason: "Preset task.", needs: [] };
const generated = { goal: "Subscribe to the newsletter.", source: "generated", reason: "Main call to action.", needs: ["email"] };
function sequenceFetch(t, handlers) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return handlers[calls.length - 1](options);
  });
  return calls;
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
test("generated suggestions are used without a second request", async (t) => {
  const calls = sequenceFetch(t, [() => json({ suggestions: [generated] })]);
  assert.deepEqual(await suggestTasks("http://localhost:8080/shop/original/"), { suggestions: [generated], generateError: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.generate, true);
});
for (const [name, first, reason] of [
  ["fails", () => json({ error: { code: "suggest_failed", message: "No valid task." } }, 502), /No valid task/],
  ["returns an empty list", () => json({ suggestions: [] }), /no suggestions/],
]) {
  test(`suggestions fall back to presets when generation ${name}`, async (t) => {
    const calls = sequenceFetch(t, [first, () => json({ suggestions: [preset] })]);
    const result = await suggestTasks("http://localhost:8080/shop/original/");
    assert.deepEqual(result.suggestions, [preset]);
    assert.match(result.generateError, reason);
    assert.deepEqual(calls.map((c) => c.body), [{ url: "http://localhost:8080/shop/original/", generate: true }, { url: "http://localhost:8080/shop/original/" }]);
  });
}
test("suggestions fall back to presets when generation times out", async (t) => {
  const calls = sequenceFetch(t, [
    (options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))),
    () => json({ suggestions: [preset] }),
  ]);
  const result = await suggestTasks("http://localhost:8080/shop/original/", undefined, 10);
  assert.deepEqual(result, { suggestions: [preset], generateError: "Task suggestions timed out." });
  assert.equal(calls.length, 2);
});
test("cancelled suggestions do not fall back, and a failed fallback is reported", async (t) => {
  const controller = new AbortController();
  const calls = sequenceFetch(t, [
    (options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))),
    () => json({ suggestions: [] }),
    () => json({ suggestions: [] }),
  ]);
  const pending = suggestTasks("http://localhost:8080/shop/original/", controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls.length, 1);
  await assert.rejects(suggestTasks("http://localhost:8080/shop/original/"), (e) => e.code === "no_suggestions");
});
test("preset suggestions are labelled as presets", () => {
  assert.equal(suggestionLabel("curated"), "Preset task");
  assert.equal(suggestionLabel("generated"), "AI-suggested task");
});
const hang = (options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
test("a preset fallback that times out is an error asking the user to describe a task", async (t) => {
  const calls = sequenceFetch(t, [() => json({ suggestions: [] }), hang]);
  await assert.rejects(suggestTasks("http://localhost:8080/shop/original/", undefined, 1000, 10),
    (e) => e.code === "suggest_timeout" && /timed out/.test(e.message) && /Describe a task yourself/.test(e.message));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.generate, undefined);
});
test("a failed preset fallback keeps the backend error and asks the user to describe a task", async (t) => {
  sequenceFetch(t, [
    () => json({ error: { code: "suggest_failed", message: "No valid task." } }, 502),
    () => json({ error: { code: "url_not_allowed", message: "URL not allowed." } }, 400),
  ]);
  await assert.rejects(suggestTasks("http://localhost:8080/shop/original/"),
    (e) => e.code === "url_not_allowed" && e.status === 400 && /URL not allowed\..*Describe a task yourself/.test(e.message));
});
test("the preset fallback has its own shorter timeout", async () => {
  const { SUGGEST_GENERATE_TIMEOUT_MS, SUGGEST_PRESET_TIMEOUT_MS } = await import("../src/api/live.ts");
  assert.equal(SUGGEST_PRESET_TIMEOUT_MS, 15_000);
  assert.ok(SUGGEST_PRESET_TIMEOUT_MS < SUGGEST_GENERATE_TIMEOUT_MS);
});
