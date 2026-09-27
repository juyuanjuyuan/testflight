import { useEffect, useState } from "react";
import { liveApi, ApiError, rerunName } from "../api/live";
import type { AuditReport, Progress } from "../api/contracts";
import { validateProgress, shouldLoadReport } from "../lib/audit";

type Snapshot = { id: string | null; revision: number; progress: Progress | null; child: Progress | null; childId: string | null;
  report: AuditReport | null; childReport: AuditReport | null; error: string | null; loading: boolean };
const empty = (id: string | null, revision: number): Snapshot => ({ id, revision, progress: null, child: null, childId: null, report: null, childReport: null, error: null, loading: !!id });

// Poll the parent to completion: a child can finish before the parent writes the final comparison.
// A new request begins only after the previous one finishes. Aborts prevent stale results after navigation.
export default function useAuditRun(id: string | null, revision: number) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => empty(id, revision));
  useEffect(() => {
    setSnapshot(empty(id, revision));
    if (!id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const signal = controller.signal;
    let loaded: AuditReport | null = null;
    let childReport: AuditReport | null = null;
    const publish = (next: Partial<Snapshot>) => { if (!signal.aborted) setSnapshot((s) => ({ ...s, ...next, id, loading: false })); };
    async function poll() {
      let repeat = true;
      try {
        let progress: Progress | null = null;
        let progressError: unknown;
        try { progress = validateProgress(await liveApi.progress(id!, signal)); } catch (e) { if (signal.aborted) return; progressError = e; }
        if (shouldLoadReport(progress, !!loaded)) {
          try { loaded = await liveApi.report(id!, signal); }
          catch (e) {
            if (signal.aborted) return;
            if (!progress || progress.state === "done") throw e;
            // Reports are expected to be missing while the first audit is running.
            if (!(e instanceof ApiError && e.status === 404)) throw e;
          }
        }
        let child: Progress | null = null;
        const childId = progress?.rerunDir || (loaded?.rerun?.runDir ? rerunName(loaded.rerun.runDir) : null);
        let childError: string | null = null;
        if (childId) {
          try {
            child = validateProgress(await liveApi.progress(childId, signal));
            if (child.state === "done") childReport = await liveApi.report(childId, signal);
          } catch (e) {
            if (signal.aborted) return;
            try { childReport = await liveApi.report(childId, signal); }
            catch { childError = "The re-test details are unavailable. The original report still contains the comparison."; }
          }
        }
        repeat = !!progress && !["done", "failed"].includes(progress.state);
        publish({ progress, child, childId, report: loaded, childReport,
          error: progress?.error || child?.error || childError || (progressError && loaded && !(progressError instanceof ApiError && progressError.status === 404) ? "Progress is unavailable. Showing the saved report." : null) });
      } catch (e) {
        if (!signal.aborted) publish({ error: e instanceof Error ? e.message : "Unable to load this run." });
      }
      if (repeat && !signal.aborted) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, revision]);
  return snapshot.id === id && snapshot.revision === revision ? snapshot : empty(id, revision);
}
