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
