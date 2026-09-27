import type { AuditReport, Progress, Rect, ShotSize } from "../api/contracts";

export function stateLabel(state: string): string {
  return ({ planning_task: "Choosing a task…", waiting_for_user: "Waiting for user action", running: "Running audit", analyzing: "Analyzing evidence", fixing: "Applying fixes to the site copy", rerunning: "Re-testing the same task", done: "Complete", failed: "Run failed", unknown: "Status unavailable" } as Record<string, string>)[state] ?? "Status unavailable";
}
export function isActive(state: string): boolean {
  return ["planning_task", "waiting_for_user", "running", "analyzing", "fixing", "rerunning"].includes(state);
}
export function auditDuration(report: AuditReport): number | null {
  const start = Date.parse(report.meta.startedAt ?? "");
  const end = Date.parse(report.meta.finishedAt ?? "");
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}
export function sourceLabel(source?: string): string {
  return ({ user: "User-confirmed task", curated: "Preset task", generated: "AI-selected task" } as Record<string, string>)[source ?? ""] ?? "Task";
}
export function canFix(report: AuditReport): boolean {
  return report.meta.mode === "local" && !!report.meta.site && !/\/patched\/?$/.test(report.meta.site);
}
export function frameGeometry(rect?: Rect | null, size?: ShotSize | null) {
  const shot = size ?? { w: 1280, h: 800, dpr: 1 };
  const valid = shot.w > 0 && shot.h > 0 && shot.dpr > 0;
  return {
    viewport: valid ? { width: shot.w, height: shot.h } : { width: 1280, height: 800 },
    focusBox: valid && rect ? [rect.x * shot.dpr / shot.w, rect.y * shot.dpr / shot.h, rect.w * shot.dpr / shot.w, rect.h * shot.dpr / shot.h] as [number, number, number, number] : undefined,
  };
}
export function validateProgress(value: Progress): Progress {
  if (typeof value.state !== "string" || !Array.isArray(value.timeline)) throw new Error("The run's progress file is invalid. You can still try opening its report.");
  return value;
}


// A new audit has no report until it finishes. Repairs already have an original report.
export function shouldLoadReport(progress: Pick<Progress, "state"> | null, loaded: boolean): boolean {
  return !progress || ["done", "failed"].includes(progress.state)
    || (!loaded && ["fixing", "rerunning"].includes(progress.state));
}
export function plannerFailure(report: AuditReport): string | null {
  return report.timeline.find((step) => step.action.plannerError)?.action.reason ?? null;
}
