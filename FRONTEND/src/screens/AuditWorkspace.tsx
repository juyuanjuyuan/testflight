import { useState } from "react";
import type { AuditReport, Finding, Progress, TimelineStep } from "../api/contracts";
import { artifactUrl } from "../api/live";
import { auditDuration, plannerFailure, canFix, frameGeometry, sourceLabel, stateLabel } from "../lib/audit";
import { clock, downloadFile, duration } from "../lib/format";
import FrameView from "../components/FrameView";
import Icon from "../components/Icon";

function Shot({ step, runDir }: { step: TimelineStep; runDir: string }) {
  const geometry = frameGeometry(step.focusRect, step.shotSize);
  const src = artifactUrl(runDir, step.screenshot);
  return src ? <FrameView key={src} src={src} {...geometry} alt={`Recorded screenshot at step ${step.i}`} label="FOCUS" />
    : <div className="frame-unavailable">Screenshot unavailable for this step.</div>;
}

export function Timeline({ steps, runDir, live = false }: { steps: TimelineStep[]; runDir: string; live?: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const step = steps.find((s) => s.i === selected) ?? steps[steps.length - 1];
  return <div className="scan-layout">
    <div className="agent-stream"><div className="stream-head"><span>{live ? "LIVE ACTIVITY" : "RECORDED ACTIVITY"}</span><span>{steps.length} RECORDS</span></div>
      {live && selected !== null && <button className="text-button" onClick={() => setSelected(null)}>Follow latest step</button>}
      <div className="event-feed">
        {!steps.length && <p className="empty-copy">Waiting for the first recorded step…</p>}
        {[...steps].reverse().map((s) => <button type="button" className={`event timeline-event ${step?.i === s.i ? "selected" : ""}`} key={s.i} onClick={() => setSelected(s.i)} aria-pressed={step?.i === s.i}>
          <span className="event-time">{s.t == null ? "—" : clock(s.t)}</span>
          <div><b>Step {s.i} · {s.action.kind}{s.action.key ? ` ${s.action.key}` : ""}</b><p>{s.action.reason}</p>
            {s.action.text && <code>{s.action.replace ? "Replace with: " : "Type: "}{s.action.text}</code>}
            {!!s.findingIds?.length && <small>Findings: {s.findingIds.join(", ")}</small>}
          </div>
        </button>)}
      </div>
    </div>
    <div className="live-browser">
      <div className="browser-chrome"><span>{step?.url ?? "Recorded browser evidence"}</span></div>
      {step ? <><Shot step={step} runDir={runDir} /><div className="evidence-text"><b>WHAT APPEARED</b>{step.seen.length ? step.seen.map((s, i) => <p key={i}>{s.text}</p>) : <p>No new visible text recorded.</p>}</div>
        <div className={`heard-caption ${step.heard.length ? "" : "silent"}`}><Icon name="pulse" /><span>{step.heard.length ? step.heard.join(" · ") : "No announcement"}</span></div>
        <div className="browser-footer"><span>Focus: {step.focus || "Not recorded"}</span></div></>
        : <div className="frame-unavailable">Browser evidence will appear here.</div>}
    </div>
  </div>;
}

export function LiveRun({ progress, child, runDir, childId }: { progress: Progress; child: Progress | null; runDir: string; childId: string | null }) {
  const shown = childId && child ? child : progress;
  const limit = shown.maxSteps;
  const percent = shown.step == null || !limit ? 0 : Math.min(100, 100 * shown.step / limit);
  return <section className="scan-screen"><div className="scan-heading"><div><span className="scan-kicker">{childId ? "VERIFICATION RUN" : "LIVE AUDIT"}</span>
    <h1 aria-live="polite">{stateLabel(progress.state)}</h1><p>{shown.goal ?? progress.goal ?? "The system is determining a task for this page."}</p>
    {progress.state === "waiting_for_user" && <p>Complete any login or CAPTCHA in Chrome, then press Enter in the backend terminal.</p>}
    {progress.state === "fixing" && <p>Generating and applying edits to a separate site copy. This may take a few minutes.</p>}
    {progress.state === "rerunning" && child?.state === "done" && <p>Re-test finished. Waiting for the final comparison…</p>}
    {progress.state === "analyzing" && <p>Evaluating the recorded evidence and preparing the report.</p>}
    </div><div className="step-count"><strong>{shown.step ?? "—"}</strong><span> {shown.step === 1 ? "step" : "steps"}</span></div></div>
    <Timeline steps={shown.timeline} runDir={childId && child ? childId : runDir} live />
    <div className="scan-progress-bar"><span style={{ width: `${percent}%` }} /></div>
    <p className="muted">Step budget used · Updated {shown.updatedAt ? new Date(shown.updatedAt).toLocaleTimeString() : "—"}</p>
  </section>;
}

export function Policy({ report }: { report: AuditReport }) {
  if (!report.fixPolicy) return null;
  return <div className="policy-grid">{(["enforced", "instructed"] as const).map((kind) => <div key={kind}><h3>{kind === "enforced" ? "Backend checks" : "Instructions to the AI"}</h3>
    <p className="muted">{kind === "enforced" ? "Checks applied by the backend to proposed edits." : "Requested behavior; not guaranteed by code checks."}</p>
    <ul>{report.fixPolicy![kind].map((rule) => <li key={rule.id}>{rule.rule}</li>)}</ul></div>)}</div>;
}

export function ReportView({ report, runDir, onInspect, onFix, busy }: { report: AuditReport; runDir: string; onInspect: (id: string) => void; onFix: (ids?: string[]) => void; busy: boolean }) {
  const elapsed = auditDuration(report);
  const verdict = report.verdicts;
  const executionError = plannerFailure(report);
  return <section className="dashboard-screen"><div className="dashboard-heading report-heading"><div><span className="result-label">AUDIT REPORT · {elapsed == null ? "Duration unavailable" : duration(elapsed)}</span><h1>Audit results</h1></div>
    <span className={`report-status ${verdict.screenReaderUserCanComplete ? "passed" : "failed"}`}>{executionError ? "AUDIT INCOMPLETE" : verdict.screenReaderUserCanComplete ? "TASK ACCESSIBLE" : "NEEDS ATTENTION"}</span></div>
    <div className="task-summary"><span>{sourceLabel(report.meta.goalSource)}</span><h2>{report.meta.goal}</h2>{report.meta.goalReason && <p>{report.meta.goalReason}</p>}
      {report.meta.testDataProfile && <small>Test data profile: {report.meta.testDataProfile}</small>}</div>
    {executionError && <div className="notice" role="alert"><b>The audit could not finish.</b><p>{executionError}</p><p>Check the backend model configuration and service connection, then start a new audit. These results do not establish whether the task is accessible.</p></div>}
    <div className="verdict-grid"><div><span>SCREEN READER USER CAN COMPLETE</span><strong>{executionError ? "Not determined" : verdict.screenReaderUserCanComplete ? "Yes" : "No"}</strong></div><div><span>AI AGENT CAN COMPLETE</span><strong>{executionError ? "Not determined" : verdict.agentCanComplete ? "Yes" : "No"}</strong></div></div>
    {!executionError && verdict.unexplainedStuck && <p className="notice">The agent was unable to complete the task, but no detector explained why. Manual review is needed.</p>}
    {report.meta.judge === false && <p className="notice">AI judging was disabled. Findings use deterministic defaults.</p>}
    <div className="report-metrics"><article><span>BLOCKING</span><strong>{report.counts.block}</strong></article><article><span>DEGRADING</span><strong>{report.counts.degrade}</strong></article><article><span>STEPS / LIMIT</span><strong>{report.timeline[report.timeline.length - 1]?.i ?? "—"} / {report.meta.maxSteps ?? "—"}</strong></article></div>
    <p className="muted">axe WCAG violations: {report.counts.axeViolations === null ? "Unavailable" : report.counts.axeViolations} · Outcome: {verdict.outcome}</p>
    <div className="issues-head"><h2>Barriers to completion</h2><button onClick={() => downloadFile(`audit-${runDir.replace(/\//g, "-")}.json`, JSON.stringify(report, null, 2), "application/json")}><Icon name="download" /> Export JSON</button></div>
    <div className="issue-list">{!report.findings.length && <p className="issue-empty">{executionError ? "No findings are available from this incomplete audit." : "No barriers were detected on this recorded path."}</p>}{report.findings.map((f) => <button className="issue-row" key={f.id} onClick={() => onInspect(f.id)}><span className={`severity-mark ${f.impact === "block" ? "critical" : "moderate"}`}>{f.impact === "block" ? "!" : "–"}</span><div className="issue-main"><span className={`pill ${f.impact === "block" ? "critical" : "moderate"}`}>{f.impact}</span><h3>{f.summary}</h3><p>{f.detector} · {f.id}</p></div><span className="inspect-link">Inspect issue <Icon name="arrow" /></span></button>)}</div>
    {canFix(report) && report.counts.block > 0 && <div className="fix-cta"><div><h3>Fix all blocking findings and re-test</h3><p>Each attempt starts from a fresh copy of the original site.</p></div><button disabled={busy} onClick={() => onFix()}>Fix &amp; re-test <Icon name="arrow" /></button></div>}
    {canFix(report) && report.counts.block === 0 && !!report.findings.length && <p className="notice">No blocking findings. Open a finding to request a targeted fix.</p>}
    {!canFix(report) && <p className="muted">This report is read-only for repairs. Re-tests must be repaired from their original audit.</p>}
    {!!report.fixes?.length && <Fixes report={report} />}
    <Policy report={report} />
    <details className="audit-details"><summary>Review recorded steps</summary><Timeline steps={report.timeline} runDir={runDir} /></details>
  </section>;
}

export function FindingView({ report, finding, runDir, onBack, onFix, busy }: { report: AuditReport; finding: Finding; runDir: string; onBack: () => void; onFix: (ids?: string[]) => void; busy: boolean }) {
  const steps = report.timeline.filter((s) => finding.steps.includes(s.i));
  return <section className="inspect-screen"><button className="back-button" onClick={onBack}><Icon name="back" /> Back to report</button><div className="inspect-heading"><div><span className={`pill ${finding.impact === "block" ? "critical" : "moderate"}`}>{finding.impact} · {finding.id}</span><h1>{finding.summary}</h1>{finding.userImpact && <p>{finding.userImpact}</p>}</div></div>
    <div className="evidence-grid"><div><span>DETECTOR</span><p>{finding.detector}</p><small>{finding.judged ? "Reviewed by the judge" : "Deterministic finding; not AI-reviewed"}</small></div><div><span>EVIDENCE</span><p>{finding.hint}</p><code>{finding.evidence.selector}</code>{finding.evidence.text && <p>{finding.evidence.text}</p>}</div><div><span>STANDARD</span><p>{finding.wcag.map((w) => `WCAG ${w}`).join(" · ")}</p><small>{finding.axeAlsoFound ? "Also found by axe" : "Not also found by axe"}</small></div></div>
    <Timeline steps={steps} runDir={runDir} />
    {canFix(report) && <div className="fix-cta"><div><h3>{report.counts.block > 0 ? "Repair the blockers on this path" : "Try a targeted repair"}</h3><p>{report.counts.block > 0 ? "The default repairs all blocking findings, then re-tests the same task." : "The backend will attempt to repair this finding on a copy."}</p></div><button disabled={busy} onClick={() => onFix(report.counts.block > 0 ? undefined : [finding.id])}>Fix &amp; re-test <Icon name="arrow" /></button></div>}
    {canFix(report) && report.counts.block > 0 && <button className="text-button" disabled={busy} onClick={() => onFix([finding.id])}>Fix only this finding &amp; re-test</button>}
    <Policy report={report} />
  </section>;
}

export function VerificationView({ report, onReport, onChild, onRecord }: { report: AuditReport; onReport: () => void; onChild?: () => void; onRecord: () => void }) {
  const rerun = report.rerun;
  if (!rerun) return <section className="dashboard-screen"><h1>Fix results</h1><p>No completed re-test comparison is available.</p><Fixes report={report} /><button className="text-button" onClick={onReport}>Back to original report</button></section>;
  return <section className="verified-screen"><span className="verified-kicker">{rerun.closedLoop ? "FIX VERIFIED" : "RE-TEST COMPLETE"}</span><h1>{rerun.closedLoop ? "The task can now be completed." : rerun.after.screenReaderUserCanComplete ? "The task remains completable." : "The task still needs attention."}</h1><p>Conclusion for the recorded task, based on the backend comparison.</p>
    <div className="outcome-transition"><strong>{rerun.before.screenReaderUserCanComplete ? "Completable" : "Not completable"}</strong><Icon name="arrow" /><strong>{rerun.after.screenReaderUserCanComplete ? "Completable" : "Not completable"}</strong></div>
    {rerun.after.unexplainedStuck && <p className="notice">The agent is stuck without a detected explanation. Manual review is needed.</p>}
    <div className="verified-facts">{rerun.status.map((s) => <span key={s.id}>{s.id}: {s.status}</span>)}<span>{rerun.introduced.length} new finding(s)</span></div>
    <p className="muted">“Resolved” means the finding was not detected on the re-test path. This does not certify the whole website.</p>
    <Fixes report={report} />
    <div className="workspace-actions"><button className="compliance-button" onClick={onRecord}>View verification record <Icon name="arrow" /></button>{onChild && <button className="text-button" onClick={onChild}>Review re-test findings</button>}<button className="text-button" onClick={onReport}>Original findings &amp; repair options</button></div>
  </section>;
}

function Fixes({ report }: { report: AuditReport }) {
  return <div className="fix-results">{report.fixes?.map((f) => <div className="task-summary" key={f.finding}><h3>{f.finding} · {f.applied === 0 ? "No edits applied" : f.errors.length ? "Partially applied" : "Edits applied"}</h3><p>{f.applied} edit(s) applied{f.rationale ? ` · ${f.rationale}` : ""}</p>{f.errors.map((e, i) => <p className="notice" key={i}>{e}</p>)}{report.findings.find((x) => x.id === f.finding)?.fix?.edits.map((edit, i) => <details className="audit-details" key={i}><summary>{edit.file} · View proposed edit</summary><div className="diff-columns"><div><h4>Before</h4><pre>{edit.old}</pre></div><div><h4>After</h4><pre>{edit.new}</pre></div></div></details>)}</div>)}</div>;
}

export function RecordView({ report, runDir }: { report: AuditReport; runDir: string }) {
  return <section className="dashboard-screen"><span className="result-label">VERIFICATION RECORD</span><h1>Evidence your team can review.</h1><p>A record of this task, applied edits and the backend re-test comparison. This is not a compliance certification.</p><div className="workspace-actions"><button className="compliance-button" onClick={() => downloadFile(`verification-${runDir.replace(/\//g, "-")}.json`, JSON.stringify(report, null, 2), "application/json")}><Icon name="download" /> Download evidence JSON</button><button className="text-button" onClick={() => window.print()}>Print record</button></div><div className="task-summary"><h2>{report.meta.goal}</h2><p>{report.meta.url}</p><p>Run: {runDir}</p><p>Generated: {report.meta.generatedAt ? new Date(report.meta.generatedAt).toLocaleString() : "—"}</p><p>Re-test: {report.rerun ? report.rerun.after.screenReaderUserCanComplete ? "Task completable" : "Needs attention" : "Not available"}</p></div><Fixes report={report} /><Policy report={report} /></section>;
}

export default ReportView;
