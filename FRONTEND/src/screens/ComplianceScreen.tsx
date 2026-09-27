import Brand from "../components/Brand";
import Icon from "../components/Icon";
import type { Report } from "../api/types";
import { hostOf } from "../lib/format";
import { compareReports } from "./VerifiedScreen";

export default function ComplianceScreen({
  before,
  after,
  pdfUrl,
}: {
  before: Report;
  after: Report;
  pdfUrl: string | null;
}) {
  const passed = after.outcome === "completed";
  const { resolved, remaining, regressions } = compareReports(before, after);
  const critical = after.findings.filter((f) => f.severity === "critical").length;
  const resolvedPercent = before.findings.length
    ? Math.round((resolved.length / before.findings.length) * 100)
    : null;
  const generated = new Date(after.generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <section className="compliance-screen">
      <div className="compliance-copy">
        <span className="result-label ready">
          <i />
          ACCESSIBILITY VERIFICATION REPORT
        </span>

        <h1>Accessibility issues, fixes, and retest results</h1>

        <p>
          A task-specific report of accessibility issues on {hostOf(before.url)},
          what was resolved, and the result of retrying “{after.goal}” with a
          screen reader.
        </p>

        <div className="compliance-stats">
          <div>
            <strong>
              {resolvedPercent === null ? "N/A" : `${resolvedPercent}%`}
            </strong>
            <span>OF FINDINGS RESOLVED</span>
          </div>

          <div>
            <strong>{critical}</strong>
            <span>CRITICAL FINDINGS REMAINING</span>
          </div>

          <div>
            <strong>{regressions.length}</strong>
            <span>NEW REGRESSIONS</span>
          </div>
        </div>

        {pdfUrl ? (
          <a className="main-action" href={pdfUrl} download>
            <Icon name="download" />
            Download signed PDF
          </a>
        ) : (
          <button
            className="main-action"
            type="button"
            disabled
            title="Available when connected to the backend"
          >
            <Icon name="download" />
            Download signed PDF
          </button>
        )}
      </div>

      <div className="report-document">
        <div className="document-glow" />

        <div className="document-page">
          <div className="doc-head">
            <Brand />
            <span>VERIFICATION REPORT</span>
          </div>

          <div className="doc-title">
            <span>{hostOf(before.url).toUpperCase()}</span>
            <h2>
              Accessibility
              <br />
              Verification Report
            </h2>
            <p>Generated {generated}</p>
          </div>

          <div className={`doc-verdict ${passed ? "passed" : "failed"}`}>
            <span>
              <Icon name={passed ? "shield" : "issue"} />
            </span>

            <div>
              <strong>{passed ? "Task completed" : "Task not completed"}</strong>
              <p>
                {critical === 0
                  ? "No critical findings remain"
                  : `${critical} critical finding${critical === 1 ? "" : "s"} remain`}
              </p>
            </div>
          </div>

          <div className="doc-grid">
            <div>
              <span>TASK RETESTED</span>
              <b>{after.goal}</b>
              <p>Retested with a screen reader</p>
            </div>

            <div>
              <span>VERIFICATION</span>
              <b>
                {resolvedPercent === null
                  ? "No initial findings"
                  : `${resolvedPercent}% of findings resolved`}
              </b>
              <p>{regressions.length} new regressions</p>
            </div>
          </div>

          {resolved.map((finding) => (
            <div className="doc-finding" key={finding.id}>
              <span>
                <Icon name="check" />
              </span>

              <div>
                <b>Resolved</b>
                <p>{finding.title}</p>
              </div>
            </div>
          ))}

          {[...remaining, ...regressions].map((finding) => (
            <div className="doc-finding open" key={finding.id}>
              <span>
                <Icon name="issue" />
              </span>

              <div>
                <b>Open · {finding.severity}</b>
                <p>{finding.title}</p>
              </div>
            </div>
          ))}

          {after.signature && (
            <div className="doc-sign">
              <span>Cryptographically signed</span>
              <code>{after.signature}</code>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
