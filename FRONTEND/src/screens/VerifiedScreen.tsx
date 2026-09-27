import Icon from "../components/Icon";
import type { Report } from "../api/types";

export function compareReports(before: Report, after: Report) {
  const afterIds = new Set(after.findings.map((finding) => finding.id));
  const beforeIds = new Set(before.findings.map((finding) => finding.id));

  return {
    resolved: before.findings.filter((finding) => !afterIds.has(finding.id)),
    remaining: after.findings.filter((finding) => beforeIds.has(finding.id)),
    regressions: after.findings.filter((finding) => !beforeIds.has(finding.id)),
  };
}

const outcomeLabel = {
  completed: "Completed",
  blocked: "Blocked",
  budget_exhausted: "Incomplete",
};

export default function VerifiedScreen({
  before,
  after,
  onCompliance,
  onReview,
}: {
  before: Report;
  after: Report;
  onCompliance: () => void;
  onReview: () => void;
}) {
  const passed = after.outcome === "completed";
  const { resolved, regressions } = compareReports(before, after);

  return (
    <section className="verified-screen">
      <div className={`success-burst ${passed ? "" : "failed"}`}>
        <div className="success-ring ring-one" />
        <div className="success-ring ring-two" />

        <span>
          <Icon name={passed ? "check" : "issue"} size={42} />
        </span>
      </div>

      <span className="verified-kicker">
        {passed ? "FIX VERIFIED" : "FIX NEEDS REVIEW"} · TASK REPLAYED
      </span>

      <h1>
        {passed
          ? "The website is now more accessible to screen readers."
          : "The task still needs attention."}
      </h1>

      <div className="outcome-transition">
        <div>
          <strong aria-label={`Before: ${outcomeLabel[before.outcome]}`}>
            {outcomeLabel[before.outcome]}
          </strong>
        </div>

        <span className="transition-line">
          <i />
          <Icon name="arrow" />
        </span>

        <div className={passed ? "after" : ""}>
          <strong aria-label={`After: ${outcomeLabel[after.outcome]}`}>
            {outcomeLabel[after.outcome]}
          </strong>
        </div>
      </div>

      <div className="verified-facts">
        <span>
          <Icon name={passed ? "check" : "issue"} />
          {passed ? "Screen reader check passed" : "Screen reader check incomplete"}
        </span>

        <span>
          <Icon name={resolved.length > 0 ? "check" : "issue"} />
          {resolved.length > 0 ? "Fix verified" : "No findings resolved"}
        </span>

        <span>
          <Icon name={passed ? "check" : "issue"} />
          {passed ? "Task completed" : "Task not completed"}
        </span>

        <span>
          <Icon name={regressions.length === 0 ? "check" : "issue"} />
          {regressions.length === 0
            ? "No regressions detected"
            : `${regressions.length} regression${regressions.length > 1 ? "s" : ""} detected`}
        </span>
      </div>

      <button className="compliance-button" type="button" onClick={onCompliance}>
        Create compliance report
        <Icon name="arrow" />
      </button>

      <button className="text-button" type="button" onClick={onReview}>
        Review updated findings
      </button>
    </section>
  );
}
