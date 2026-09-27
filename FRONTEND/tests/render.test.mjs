import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL) {
      const url = new URL(specifier, context.parentURL);
      for (const ext of [".ts", ".tsx"]) {
        if (existsSync(fileURLToPath(url) + ext)) return next(url.href + ext, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.tsx?$/.test(url)) {
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
      }).outputText;
      return { format: "module", source, shortCircuit: true };
    }
    return next(url, context);
  },
});
const { LiveRun, RecordView, ReportView, VerificationView } = await import("../src/screens/AuditWorkspace.tsx");
const verdict = { outcome: "done", agentCanComplete: true, screenReaderUserCanComplete: false, blockingFindings: ["F1"], unexplainedStuck: false };
const report = {
  meta: { goal: "Buy a jacket", mode: "local", site: "sites/shop/original", maxSteps: 73, goalSource: "generated" },
  verdicts: verdict, counts: { block: 1, degrade: 0, filteredOut: 0, axeViolations: null },
  timeline: [], findings: [],
  fixPolicy: { enforced: [{ id: "check", rule: "Only permitted files" }], instructed: [{ id: "prompt", rule: "Preserve design" }] },
};
test("report renders distinct agent/user outcomes and dynamic limit; policy boundaries only in the record", () => {
  const html = renderToStaticMarkup(React.createElement(ReportView, { report, runDir: "run-1", busy: false }));
  assert.match(html, /CAUTION/);
  assert.match(html, /AI-selected task/);
  assert.match(html, /73/);
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /not guaranteed by code checks/);
  assert.match(html, /Fix all blocking findings/);
  assert.match(renderToStaticMarkup(React.createElement(RecordView, { report, runDir: "run-1" })), /not guaranteed by code checks/);
});
test("completed child keeps parent in re-test state until comparison is written", () => {
  const progress = { state: "rerunning", timeline: [], step: null, maxSteps: 73, goal: null };
  const html = renderToStaticMarkup(React.createElement(LiveRun, { progress, child: { ...progress, state: "done" }, runDir: "parent", childId: "child" }));
  assert.match(html, /Waiting for the final comparison/);
  assert.doesNotMatch(html, /FIX VERIFIED/);
});
test("unsuccessful repairs never render a success verdict and surface partial errors", () => {
  const html = renderToStaticMarkup(React.createElement(VerificationView, {
    report: { ...report, fixes: [{ finding: "F1", applied: 1, errors: ["Second edit rejected"] }],
      rerun: { runDir: "runs/child", before: verdict, after: verdict, closedLoop: false, status: [{ id: "F1", status: "persists" }], introduced: [] } },
  }));
  assert.match(html, /still needs attention/);
  assert.match(html, /Partially applied/);
  assert.match(html, /Second edit rejected/);
  assert.match(html, /persists/);
  assert.doesNotMatch(html, /FIX VERIFIED/);
});
test("planner failure is an incomplete audit, not an accessibility verdict", () => {
  const html = renderToStaticMarkup(React.createElement(ReportView, {
    report: { ...report, counts: { ...report.counts, block: 0 },
      timeline: [{ i: 1, action: { kind: "stuck", reason: 'planner error: no model configured for role "planner"', plannerError: true }, seen: [], heard: [], findingIds: [] }] },
    runDir: "failed-planner", busy: false,
  }));
  assert.match(html, /AUDIT INCOMPLETE/);
  assert.match(html, /no model configured/);
  assert.doesNotMatch(html, /No barriers were detected/);
  assert.doesNotMatch(html, /<strong>No<\/strong>/);
});
test("an unrecognized live state renders as processing, not an error", () => {
  const progress = { state: "verifying_future", timeline: [], step: 2, maxSteps: 73, goal: "Buy a jacket", updatedAt: "" };
  const html = renderToStaticMarkup(React.createElement(LiveRun, { progress, child: null, runDir: "run-1", childId: null }));
  assert.match(html, /Processing…/);
  assert.doesNotMatch(html, /Status unavailable|Run failed/);
});
const inconclusive = { outcome: "stuck", agentCanComplete: null, screenReaderUserCanComplete: null, blockingFindings: ["F4"], unexplainedStuck: false, inconclusiveReason: "missing_test_data" };
test("null verdicts render as inconclusive with the missing test data reason, never as No", () => {
  const html = renderToStaticMarkup(React.createElement(ReportView, { report: { ...report, verdicts: inconclusive }, runDir: "run-1", busy: false }));
  assert.match(html, /INCONCLUSIVE/);
  assert.match(html, /report-status inconclusive/);
  assert.equal(html.match(/<strong>Inconclusive<\/strong>/g)?.length, 2);
  assert.match(html, /Inconclusive: the task is missing test data \(for example, a card number\)\. Add it and run again\./);
  assert.doesNotMatch(html, /CAUTION|<strong>No<\/strong>|TASK ACCESSIBLE/);
  assert.doesNotMatch(html, /no detector explained why/);
});
test("null verdict without a known reason is still inconclusive and separate from unexplained stuck", () => {
  const verdicts = { ...inconclusive, inconclusiveReason: undefined, unexplainedStuck: true };
  const html = renderToStaticMarkup(React.createElement(ReportView, { report: { ...report, verdicts }, runDir: "run-1", busy: false }));
  assert.match(html, /<p class="notice inconclusive-notice">Inconclusive: the backend could not determine/);
  assert.match(html, /<p class="notice">The agent was unable to complete the task, but no detector explained why/);
  assert.doesNotMatch(html, /missing test data/);
});
test("inconclusive re-test comparisons are neither failures nor verified fixes", () => {
  const rerun = { runDir: "runs/child", before: inconclusive, after: inconclusive, closedLoop: false, status: [], introduced: [] };
  const html = renderToStaticMarkup(React.createElement(VerificationView, { report: { ...report, rerun } }));
  assert.match(html, /No before-and-after comparison is possible\./);
  assert.equal(html.match(/<strong>Inconclusive<\/strong>/g)?.length, 2);
  assert.match(html, /Original audit · Inconclusive: the task is missing test data/);
  assert.match(html, /Re-test · Inconclusive: the task is missing test data/);
  assert.doesNotMatch(html, /Not completable|still needs attention|FIX VERIFIED/);
  const partial = renderToStaticMarkup(React.createElement(VerificationView, { report: { ...report, rerun: { ...rerun, after: verdict } } }));
  assert.match(partial, /<strong>Inconclusive<\/strong>.*<strong>Not completable<\/strong>/);
  assert.doesNotMatch(partial, /Re-test · Inconclusive/);
  const record = renderToStaticMarkup(React.createElement(RecordView, { report: { ...report, rerun }, runDir: "run-1" }));
  assert.match(record, /Re-test: Inconclusive/);
  assert.doesNotMatch(record, /Needs attention/);
});
test("automatically appended test data is labelled next to the task with the user's original input", () => {
  const goal = "Buy one thing. Pay with card 4000 0000 0000 0002; if it is declined, use 4242 4242 4242 4242.";
  const appended = { ...report, meta: { ...report.meta, goal, goalSource: "user", goalInput: "Buy one thing", testDataAppended: true, testDataProfile: "shop" } };
  for (const html of [
    renderToStaticMarkup(React.createElement(ReportView, { report: appended, runDir: "run-1", busy: false })),
    renderToStaticMarkup(React.createElement(RecordView, { report: appended, runDir: "run-1" })),
  ]) {
    assert.match(html, /<h2>Buy one thing\. Pay with card 4000 0000 0000 0002.*<\/h2><div class="test-data-note"><small>Test data added automatically<\/small><p>Your original task: Buy one thing<\/p>/);
  }
  const plain = renderToStaticMarkup(React.createElement(ReportView, { report: { ...report, meta: { ...report.meta, goalInput: "ignored" } }, runDir: "run-1", busy: false }));
  assert.doesNotMatch(plain, /Test data added automatically|Your original task/);
});
test("an inconclusive audit before the fix is reported as no comparison, not as a failed fix", () => {
  for (const after of [verdict, { ...verdict, agentCanComplete: true, screenReaderUserCanComplete: true }, inconclusive]) {
    const rerun = { runDir: "runs/child", before: inconclusive, after, closedLoop: false, status: [], introduced: [] };
    const html = renderToStaticMarkup(React.createElement(VerificationView, { report: { ...report, rerun } }));
    assert.match(html, /No before-and-after comparison is possible\./);
    assert.match(html, /before the fix was inconclusive/);
    assert.doesNotMatch(html, /FIX VERIFIED|still needs attention|remains completable|re-test was inconclusive/);
  }
});
test("an inconclusive re-test after a definite audit is labelled as such", () => {
  const rerun = { runDir: "runs/child", before: verdict, after: inconclusive, closedLoop: false, status: [], introduced: [] };
  const html = renderToStaticMarkup(React.createElement(VerificationView, { report: { ...report, rerun } }));
  assert.match(html, /The re-test was inconclusive\./);
  assert.match(html, /<strong>Not completable<\/strong>.*<strong>Inconclusive<\/strong>/);
  assert.doesNotMatch(html, /No before-and-after comparison/);
});
