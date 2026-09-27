import test from "node:test";
import assert from "node:assert/strict";
import { liveApi, ApiError, artifactUrl, rerunName } from "../src/api/live.ts";
import { frameGeometry, stateLabel, canFix, auditDuration, validateProgress } from "../src/lib/audit.ts";

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
  assert.equal(stateLabel("future"), "Status unavailable");
  assert.equal(stateLabel("planning_task"), "Choosing a task…");
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
