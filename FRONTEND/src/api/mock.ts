// 本地 mock 后端：实现与真实后端完全相同的 AuditApi 接口，
// 按时间回放 mockData.ts 里的事件。用于没有后端时的开发和现场演示兜底。

import type { AuditApi, Unsubscribe } from "./client";
import type { FixEvent, Report, RunEvent } from "./types";
import {
  buildTurns,
  demoFindings,
  demoPatches,
  fixStages,
} from "./mockData";

type Subscription = {
  onEvent: (event: RunEvent) => void;
  timers: number[];
  delivered: number;
};

type MockRun = {
  events: RunEvent[];
  report: Report;
  startedAt: number;
  skipped: boolean;
  subscriptions: Set<Subscription>;
};

const MAX_TURNS = 16;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const randomId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

function buildEvents(
  runId: string,
  url: string,
  goal: string,
  parentRunId: string | undefined,
  fixed: Set<string>,
) {
  const turns = buildTurns(fixed);
  const events: RunEvent[] = [];
  let t = 400;

  events.push({
    type: "run.started",
    t: 0,
    runId,
    url,
    goal,
    maxTurns: MAX_TURNS,
    parentRunId,
    viewport: { width: 1440, height: 900 },
  });

  turns.forEach((turn, index) => {
    const n = index + 1;
    events.push({ type: "turn.intent", t, turn: n, text: turn.intent });

    turn.commands.forEach((command, attempt) => {
      t += 300;
      events.push({
        type: "turn.command",
        t,
        turn: n,
        attempt: attempt + 1,
        summary: command.summary,
      });

      if (command.rejected) {
        t += 250;
        events.push({
          type: "turn.rejected",
          t,
          turn: n,
          attempt: attempt + 1,
          reason: command.rejected,
        });
      }
    });

    t += 200;
    events.push({ type: "turn.executed", t, turn: n, ok: true });
    t += 80;
    events.push({
      type: "turn.frame",
      t,
      turn: n,
      screenshotUrl: turn.frame,
      pageUrl: turn.pageUrl,
      focusBox: turn.focus,
    });
    t += 220;
    events.push({ type: "turn.heard", t, turn: n, announcements: turn.heard });
    t += 250;
  });

  const errorFixed = fixed.has("AR-201");
  const remaining = demoFindings.filter((finding) => !fixed.has(finding.id));
  const outcome = errorFixed ? "completed" : "blocked";

  events.push({ type: "run.ended", t, outcome, turns: turns.length });
  t += 500;
  events.push({ type: "analysis.stage", t, stage: "trace" });
  t += 700;
  events.push({ type: "analysis.stage", t, stage: "detect" });
  t += 500;
  const axe = Math.max(0, 12 - fixed.size * 2);
  const deterministic = remaining.length + 2;
  events.push({ type: "analysis.detected", t, axe, deterministic });
  t += 400;
  events.push({ type: "analysis.stage", t, stage: "judge" });
  t += 700;
  events.push({
    type: "analysis.judged",
    t,
    kept: remaining.length,
    dropped: axe + deterministic - remaining.length,
  });
  t += 400;
  events.push({ type: "analysis.stage", t, stage: "report" });
  t += 500;
  events.push({ type: "report.ready", t });

  const critical = remaining.filter((f) => f.severity === "critical").length;
  const moderate = remaining.filter((f) => f.severity === "moderate").length;
  const report: Report = {
    runId,
    parentRunId,
    url,
    goal,
    outcome,
    headline:
      outcome === "completed"
        ? "The original task was completed."
        : "The original task could not be completed.",
    summary:
      outcome === "completed"
        ? critical === 0
          ? "The screen reader agent completed the original task with no critical barriers."
          : `The task completed, but ${critical} critical accessibility finding${critical === 1 ? "" : "s"} remain.`
        : `The screen reader agent could not complete the original task; ${critical} critical barrier${critical === 1 ? "" : "s"} remain.`,
    durationMs: 60_000 + turns.length * 3_500,
    turns: turns.length,
    pagesVisited: new Set(turns.map((turn) => turn.pageUrl)).size,
    detected: { axe, deterministic },
    findings: remaining,
    generatedAt: new Date().toISOString(),
    signature: "sha256:7c9e41d0…a812",
  };

  return { events, report };
}

export function createMockApi(): AuditApi {
  const runs = new Map<string, MockRun>();
  const patches = new Map<string, (typeof demoPatches)[string]>();
  /** 已应用到网站副本上的修复（在整个会话里累积） */
  const fixedOnCopy = new Set<string>();

  const deliverRemaining = (run: MockRun, sub: Subscription) => {
    sub.timers.forEach(window.clearTimeout);
    sub.timers = [];
    run.events.slice(sub.delivered).forEach((event) => sub.onEvent(event));
    sub.delivered = run.events.length;
  };

  return {
    mode: "demo",

    async createRun({ url, goal, parentRunId }) {
      await delay(300);
      const runId = randomId("run");
      const fixed = parentRunId ? new Set(fixedOnCopy) : new Set<string>();
      const { events, report } = buildEvents(runId, url, goal, parentRunId, fixed);
      runs.set(runId, {
        events,
        report,
        startedAt: Date.now(),
        skipped: false,
        subscriptions: new Set(),
      });
      return { runId };
    },

    subscribeRun(runId, onEvent): Unsubscribe {
      const run = runs.get(runId);
      if (!run) {
        onEvent({ type: "error", t: 0, message: `Unknown run ${runId}` });
        return () => {};
      }

      const sub: Subscription = { onEvent, timers: [], delivered: 0 };
      run.subscriptions.add(sub);

      if (run.skipped) {
        deliverRemaining(run, sub);
      } else {
        const elapsed = Date.now() - run.startedAt;
        run.events.forEach((event) => {
          sub.timers.push(
            window.setTimeout(() => {
              sub.onEvent(event);
              sub.delivered += 1;
            }, Math.max(0, event.t - elapsed)),
          );
        });
      }

      return () => {
        sub.timers.forEach(window.clearTimeout);
        run.subscriptions.delete(sub);
      };
    },

    skip(runId) {
      const run = runs.get(runId);
      if (!run) return;
      run.skipped = true;
      run.subscriptions.forEach((sub) => deliverRemaining(run, sub));
    },

    async getReport(runId) {
      await delay(200);
      const run = runs.get(runId);
      if (!run) throw new Error(`Unknown run ${runId}`);
      return run.report;
    },

    async createFix(_runId, findingIds) {
      await delay(200);
      const template = demoPatches[findingIds[0]];
      if (!template) throw new Error(`No constrained fix for ${findingIds[0]}`);
      const fixId = randomId("fix");
      patches.set(fixId, template);
      return { fixId, stages: fixStages };
    },

    subscribeFix(fixId, onEvent: (event: FixEvent) => void) {
      const timers = fixStages.map((label, index) =>
        window.setTimeout(
          () => onEvent({ type: "fix.stage", index, label }),
          300 + index * 600,
        ),
      );
      timers.push(
        window.setTimeout(
          () => onEvent({ type: "fix.ready", patchId: fixId }),
          300 + fixStages.length * 600,
        ),
      );
      return () => timers.forEach(window.clearTimeout);
    },

    async getPatch(patchId) {
      await delay(150);
      const patch = patches.get(patchId);
      if (!patch) throw new Error(`Unknown patch ${patchId}`);
      return { id: patchId, ...patch };
    },

    async applyPatch(patchId) {
      await delay(400);
      const patch = patches.get(patchId);
      if (!patch) throw new Error(`Unknown patch ${patchId}`);
      patch.findingIds.forEach((id) => fixedOnCopy.add(id));
      return { copyUrl: "https://copy.accessrun.local/staging.acme.store" };
    },

    complianceUrl: () => null,
  };
}
