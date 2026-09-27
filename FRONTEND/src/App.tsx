import { useEffect, useRef, useState } from "react";
import Brand from "./components/Brand";
import Icon from "./components/Icon";
import LandingScreen from "./screens/LandingScreen";
import { FindingView, LiveRun, RecordView, ReportView, VerificationView } from "./screens/AuditWorkspace";
import { liveApi, rerunName, runPath } from "./api/live";
import type { RunList, Suggestion } from "./api/contracts";
import { canFix, isActive, stateLabel } from "./lib/audit";
import useAuditRun from "./hooks/useAuditRun";

type View = "landing" | "setup" | "history" | "run" | "report" | "finding" | "verify" | "record";
function initialRun() {
  const value = new URLSearchParams(window.location.search).get("run");
  if (!value) return null;
  try { runPath(value); return value; } catch { return null; }
}
const message = (e: unknown) => e instanceof Error ? e.message : "The request could not be completed.";

export default function App() {
  const [runId, setRunId] = useState<string | null>(initialRun);
  const [view, setView] = useState<View>(() => initialRun() ? "run" : "landing");
  const [revision, setRevision] = useState(0);
  const run = useAuditRun(runId, revision);
  const [url, setUrl] = useState(import.meta.env.VITE_DEMO_URL || "http://localhost:8080/shop/original/");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const suggestionRequest = useRef<AbortController | null>(null);
  const mutationLock = useRef(false);
  const [history, setHistory] = useState<RunList | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [findingId, setFindingId] = useState<string | null>(null);
  const [showChild, setShowChild] = useState(false);
  const report = showChild ? run.childReport : run.report;
  const reportId = showChild ? run.childId : runId;
  const active = !!run.progress && isActive(run.progress.state);

  useEffect(() => () => suggestionRequest.current?.abort(), []);
  useEffect(() => {
    const onPop = () => { setRunId(initialRun()); setShowChild(false); setView(initialRun() ? "run" : "setup"); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (view !== "history") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await liveApi.list(controller.signal);
        if (!controller.signal.aborted) { setHistory(next); setHistoryError(null); }
      } catch (e) { if (!controller.signal.aborted) setHistoryError(message(e)); }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 5000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [view, historyRevision]);

  function openRun(id: string) {
    runPath(id);
    setRunId(id); setRevision((n) => n + 1); setShowChild(false); setView("run"); setError(null); setFindingId(null);
    const link = new URL(window.location.href); link.searchParams.set("run", id); link.searchParams.delete("demo");
    window.history.pushState({}, "", link); window.scrollTo({ top: 0 });
  }
  async function start() {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setError(null);
    try { const result = await liveApi.start(url, goal); openRun(result.runDir); }
    catch (e) { setError(message(e)); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  async function fix(ids?: string[]) {
    if (!runId || !run.report || !canFix(run.report) || active || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setError(null);
    try {
      await liveApi.fix(runId, ids);
      setShowChild(false); setView("run"); setRevision((n) => n + 1);
    } catch (e) { setError(message(e)); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  async function suggest() {
    suggestionRequest.current?.abort();
    const controller = new AbortController(); suggestionRequest.current = controller;
    setSuggesting(true); setError(null); setSuggestions([]);
    try {
      const result = await liveApi.suggest(url, controller.signal);
      if (controller.signal.aborted) return;
      // Presets from eval/groundtruth are fixed text, not suggestions; only show model-generated tasks.
      const generated = result.suggestions.filter((s) => s.source === "generated");
      if (generated.length) setSuggestions(generated);
      else setError("The audit service returned only preset tasks. Update the backend to support AI-generated suggestions, or describe a task yourself.");
    } catch (e) { if (!controller.signal.aborted) setError(message(e)); }
    finally { if (!controller.signal.aborted) setSuggesting(false); }
  }
  function editUrl(value: string) {
    suggestionRequest.current?.abort(); setSuggesting(false); setSuggestions([]); setUrl(value);
  }
  const effectiveView = view === "run" && !active && run.report && !run.loading
    ? run.progress?.state === "failed" ? "report" : run.report.rerun ? "verify" : "report" : view;
  const selected = report?.findings.find((f) => f.id === findingId);
  const fixDisabled = busy || active || showChild;
  const currentStep = effectiveView === "setup" || effectiveView === "history" ? 0 : effectiveView === "finding" ? 3 : effectiveView === "record" ? 6 : effectiveView === "verify" ? 5 : effectiveView === "report" ? 2 : run.progress?.state === "fixing" ? 4 : run.progress?.state === "rerunning" ? 5 : 1;
  const nav = ["Connect", "Scan", "Report", "Inspect", "Fix", "Verify", "Record"];
  const validUrl = (() => { try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; } })();

  if (view === "landing") return <div className="product-shell landing-active"><main><LandingScreen onEnter={() => setView("setup")} /></main></div>;
  return <div className="product-shell live-workspace">
    <header className="site-header"><Brand /><div className="header-actions"><button className="text-button" disabled={busy} onClick={() => { setView("setup"); setError(null); }}>New audit</button><button className="text-button" disabled={busy} onClick={() => { setView("history"); setHistoryRevision((n) => n + 1); setError(null); }}>Run history</button>{runId && <button className="text-button" disabled={busy} onClick={() => { setView("run"); setShowChild(false); }}>Current run</button>}</div></header>
    <nav className="progress-wrap" aria-label="Audit progress"><div className="flow-stepper">{nav.map((label, index) => <button key={label} className={`flow-step ${index === currentStep ? "active" : ""}`} aria-current={index === currentStep ? "step" : undefined} disabled={busy || !((index === 0 || (index === 1 && !!runId)) || (index === 2 && !!run.report) || (index === 3 && !!selected) || ([5, 6].includes(index) && !!run.report?.rerun))} onClick={() => { if (index !== 3) setShowChild(false); setView(index === 0 ? "setup" : index === 1 ? "run" : index === 2 ? "report" : index === 3 ? "finding" : index === 5 ? "verify" : "record"); }}><span>{index + 1}</span><small>{label}</small>{index < nav.length - 1 && <i />}</button>)}</div></nav>
    {error && <div className="app-error" role="alert"><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
    <main>
      {view === "setup" && <section className="connect-screen"><div className="ambient ambient-one" /><form className="launch-card" onSubmit={(e) => { e.preventDefault(); void start(); }}><div className="launch-top"><div className="live-orb"><Icon name="pulse" /></div><div><span>NEW AUDIT</span><h2>What should we test?</h2></div></div>
        <label htmlFor="site-url">Website URL</label><div className="url-field"><Icon name="globe" /><input id="site-url" type="url" value={url} disabled={busy} onChange={(e) => editUrl(e.target.value)} required /></div>
        <label htmlFor="goal">Task goal <small>(optional)</small></label><div className="goal-field"><Icon name="spark" /><input id="goal" value={goal} maxLength={500} disabled={busy} onChange={(e) => setGoal(e.target.value)} placeholder="Leave blank to let the system choose a task" /></div>
        <button type="button" className="suggest-button" disabled={suggesting || busy || !validUrl} onClick={() => void suggest()}>{suggesting ? "Finding suggestions…" : "Suggest tasks"}</button>
        <div className="task-suggestions" aria-live="polite">{suggestions.map((s, i) => <button type="button" key={i} disabled={busy} onClick={() => { setGoal(s.goal); setSuggestions([]); }}><b>AI-suggested task</b><p>{s.goal}</p><small>{s.reason}</small></button>)}</div>
        <button className="hero-button" type="submit" disabled={busy || !validUrl}><span>{busy ? "Starting…" : "Start audit"}</span><Icon name="arrow" /></button>
        <p className="launch-note">Web audits currently support the backend's local test sites. Real-site audits are started from the backend terminal and can be viewed in Run history.</p>
      </form></section>}
      {view === "history" && <section className="dashboard-screen"><div className="dashboard-heading"><div><span className="result-label">AUDIT WORKSPACE</span><h1>Run history</h1></div><button className="text-button" onClick={() => setHistoryRevision((n) => n + 1)}>Refresh</button></div>
        {historyError && <p className="notice" role="alert">{historyError}</p>}{!history && !historyError && <p>Loading runs…</p>}
        {history && !history.runs.length && <p>No recorded runs yet. Start an audit to create one.</p>}
        <div className="history-list">{history?.runs.map((r) => <button className="history-row" key={r.runDir} onClick={() => openRun(r.runDir)}><div><b>{r.goal ?? "Task not selected yet"}</b><p>{r.url ?? "Waiting for the start page"}</p><small>{r.runDir}</small></div><div><strong>{stateLabel(r.state)}</strong><p>{r.screenReaderUserCanComplete === null ? "No verdict yet" : r.screenReaderUserCanComplete ? "Audit: task completable" : "Audit: needs attention"}</p>{r.progress === "corrupt" && <small>Progress unavailable · saved report available</small>}</div><Icon name="arrow" /></button>)}</div>
        {!!history?.skipped && <details className="audit-details"><summary>{history.skipped} unreadable run(s) omitted</summary>{Object.entries(history.skippedReasons ?? {}).map(([reason, count]) => <p key={reason}>{reason}: {count}</p>)}</details>}
      </section>}
      {!["setup", "history"].includes(view) && <>
        {run.error && <div className="app-error" role="alert"><span>{run.error}</span><button onClick={() => setRevision((n) => n + 1)}>Retry loading</button></div>}
        {run.loading && <section className="generation-screen"><h1>Loading run…</h1></section>}
        {effectiveView === "run" && run.progress && runId && <LiveRun progress={run.progress} child={run.child} runDir={runId} childId={run.childId} />}
        {effectiveView === "run" && !run.progress && !run.loading && !run.report && <section className="generation-screen"><h1>Run unavailable</h1><p>Check the service connection, or choose another run from history.</p></section>}
        {effectiveView === "report" && report && reportId && <ReportView report={report} runDir={reportId} busy={fixDisabled} onFix={(ids) => void fix(ids)} onInspect={(id) => { setFindingId(id); setView("finding"); }} />}
        {effectiveView === "finding" && report && reportId && selected && <FindingView report={report} finding={selected} runDir={reportId} busy={fixDisabled} onBack={() => setView("report")} onFix={(ids) => void fix(ids)} />}
        {effectiveView === "verify" && run.report && <VerificationView report={run.report} onReport={() => { setShowChild(false); setView("report"); }} onRecord={() => setView("record")} onChild={run.childReport ? () => { setShowChild(true); setView("report"); } : run.report.rerun ? () => openRun(rerunName(run.report!.rerun!.runDir)) : undefined} />}
        {effectiveView === "record" && run.report && runId && <RecordView report={run.report} runDir={runId} />}
      </>}
    </main>
  </div>;
}
