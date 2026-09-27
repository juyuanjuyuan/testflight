import Icon from "../components/Icon";
import type { Report } from "../api/types";
import { downloadFile, duration } from "../lib/format";

export default function ReportScreen({
  report,
  onInspect,
}: {
  report: Report;
  onInspect: (findingId: string) => void;
}) {
  const passed = report.outcome === "completed";
  const count = (severity: string) =>
    report.findings.filter((finding) => finding.severity === severity).length;
  const critical = count("critical");
  const moderateMinor = count("moderate") + count("minor");

  return (
    <section className="dashboard-screen">
      <div className="dashboard-heading report-heading">
        <div>
          <span className={`result-label ${passed ? "ready" : "failed"}`}>
            <i />
            {report.parentRunId ? "VERIFICATION" : "AUDIT"} COMPLETE ·{" "}
            {duration(report.durationMs)}
          </span>

          <h1>Audit results</h1>
        </div>

        <div
          className={`report-status ${passed ? "passed" : "failed"}`}
          role="status"
          aria-label={passed ? "Audit passed" : "Audit failed"}
        >
          <Icon name={passed ? "check" : "issue"} size={20} />
          <strong>{passed ? "PASSED" : "FAILED"}</strong>
        </div>
      </div>

      <div className="report-metrics">
        <article>
          <span>CRITICAL</span>
          <strong>{critical}</strong>
        </article>

        <article>
          <span>MODERATE / MINOR</span>
          <strong>{moderateMinor}</strong>
        </article>

        <article>
          <span>TURNS TAKEN</span>
          <strong>{report.turns}</strong>
        </article>
      </div>

      <div className="issues-head">
        <div>
          <h2>Barriers to completion</h2>
        </div>

        <button
          type="button"
          onClick={() =>
            downloadFile(
              `accessrun-${report.runId}.json`,
              JSON.stringify(report, null, 2),
              "application/json",
            )
          }
        >
          <Icon name="download" />
          Export
        </button>
      </div>

      <div className="issue-list">
        {report.findings.length === 0 && (
          <div className="issue-empty">
            <Icon name="check" />
            No barriers found in this audit.
          </div>
        )}

        {report.findings.map((finding) => (
          <button
            className="issue-row"
            type="button"
            key={finding.id}
            aria-label={`${finding.severity}: ${finding.title}. Inspect issue.`}
            onClick={() => onInspect(finding.id)}
          >
            <span className={`severity-mark ${finding.severity}`}>
              {finding.severity === "critical" ? "!" : "–"}
            </span>

            <div className="issue-main">
              <span className={`pill ${finding.severity}`}>
                {finding.severity}
              </span>
              <h3>{finding.title}</h3>
            </div>

            <span className="issue-actions">
              <span className="wcag" aria-label="WCAG criteria">
                WCAG {finding.wcag.map((criterion) => criterion.id).join(" · ")}
              </span>

              <span className="inspect-link">
                Inspect issue
                <Icon name="arrow" />
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}