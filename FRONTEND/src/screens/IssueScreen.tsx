import FrameView from "../components/FrameView";
import Icon from "../components/Icon";
import type { Finding } from "../api/types";

export default function IssueScreen({
  finding,
  busy,
  onBack,
  onFix,
}: {
  finding: Finding;
  busy: boolean;
  onBack: () => void;
  onFix: () => void;
}) {
  const { evidence } = finding;
  const silent = evidence.heard.length === 0;

  return (
    <section className="inspect-screen">
      <button className="back-button" type="button" onClick={onBack}>
        <Icon name="back" />
        Back to report
      </button>

      <div className="inspect-heading">
        <div>
          <span className={`pill ${finding.severity}`}>
            {finding.severity} · {finding.id}
          </span>

          <h1>{finding.title}.</h1>

          <p>{finding.impact}</p>
        </div>

        <div className="issue-confidence">
          <Icon name="shield" />

          <div>
            <strong>{Math.round(finding.confidence * 100)}% confidence</strong>
            <span>
              Backed by trace + DOM evidence · {finding.page}, turn {finding.turn}
            </span>
          </div>
        </div>
      </div>

      <div className="evidence-compare">
        <div className="evidence-card visual">
          <div className="evidence-title">
            <span>
              <Icon name="eye" />
              WHAT APPEARED ON SCREEN
            </span>
            <b>VISIBLE</b>
          </div>

          <div className="evidence-shot">
            <FrameView
              src={evidence.screenshotUrl}
              focusBox={evidence.focusBox}
              tone="alert"
              alt={`Screenshot at turn ${finding.turn}`}
            />
          </div>
        </div>

        <div className="difference-marker">
          <span>≠</span>
          <small>MISMATCH</small>
        </div>

        <div className="evidence-card assistive">
          <div className="evidence-title">
            <span>
              <Icon name="pulse" />
              WHAT THE USER HEARD
            </span>
            <b>{silent ? "SILENT" : "HEARD"}</b>
          </div>

          <div className="screen-reader-output">
            {silent ? (
              <>
                <div className="sound-bars">
                  {Array.from({ length: 18 }).map((_, i) => (
                    <i key={i} />
                  ))}
                </div>
                <Icon name="issue" size={28} />
                <strong>No announcement</strong>
              </>
            ) : (
              <ul className="heard-list">
                {evidence.heard.map((line) => (
                  <li key={line}>“{line}”</li>
                ))}
              </ul>
            )}

            <p>{evidence.explanation}</p>
          </div>
        </div>
      </div>

      <div className="evidence-grid">
        <div>
          <span>USER IMPACT</span>
          <p>{evidence.userImpact}</p>
          {evidence.userIntent && (
            <p className="user-quote">User agent: “{evidence.userIntent}”</p>
          )}
        </div>

        <div>
          <span>DETERMINISTIC EVIDENCE</span>
          {evidence.facts.map((fact) => (
            <code key={fact}>{fact}</code>
          ))}
        </div>

        <div>
          <span>STANDARD</span>
          <p>
            {finding.wcag.map((criterion) => (
              <span className="wcag-line" key={criterion.id}>
                <b>WCAG {criterion.id}</b> {criterion.name}
              </span>
            ))}
          </p>
        </div>
      </div>

      <div className="fix-cta">
        <div className="fix-graphic">
          <Icon name="spark" size={27} />
          <span />
        </div>

        <div>
          <span>NEXT: CONSTRAINED REMEDIATION</span>
          <h3>
            {finding.fixable ? "Generate a constrained fix" : "Manual fix required"}
          </h3>
          <p>
            {finding.fixable
              ? "The Fixer will create a minimal patch on a copy of the site, explain every change, then re-run the same goal."
              : finding.notFixableReason}
          </p>
        </div>

        <button type="button" onClick={onFix} disabled={!finding.fixable || busy}>
          {busy ? "Starting…" : "Generate verified fix"}
          <Icon name="arrow" />
        </button>
      </div>
    </section>
  );
}
