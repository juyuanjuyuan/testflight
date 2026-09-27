import Icon from "../components/Icon";
import type { AnalysisStage } from "../api/types";
import type { RunState } from "../hooks/useRunStream";

const order: AnalysisStage[] = ["trace", "detect", "judge", "report"];

export default function AnalyzeScreen({
  run,
  isVerification,
}: {
  run: RunState;
  isVerification: boolean;
}) {
  const { stage, detected, judged } = run.analysis;
  const current = run.reportReady ? order.length : stage ? order.indexOf(stage) : -1;
  const progress = Math.round(((current + 1) / (order.length + 1)) * 100);

  const steps: [string, string?][] = [
    ["Assembling trace, screenshots, and page changes"],
    [
      "Running deterministic detectors + axe-core",
      detected && `${detected.axe + detected.deterministic} candidates`,
    ],
    [
      "Judge: filtering by impact on the task",
      judged && `kept ${judged.kept} · dropped ${judged.dropped}`,
    ],
    [isVerification ? "Comparing with the original run" : "Writing the report"],
  ];

  return (
    <section className="generation-screen">
      <div className="generation-orb">
        <span />
        <Icon name="layers" size={34} />
      </div>

      <span className="gen-kicker">EVIDENCE PIPELINE</span>

      <h1>
        {isVerification
          ? "Checking what changed."
          : "Turning the trace into evidence."}
      </h1>

      <p>
        {run.ended
          ? `The agent ${
              run.ended.outcome === "completed" ? "completed the goal" : "was blocked"
            } after ${run.ended.turns} turns.`
          : "Collecting the final trace…"}
      </p>

      <div className="gen-steps">
        {steps.map(([label, detail], index) => (
          <div
            className={`${index < current ? "done" : ""} ${index === current ? "active" : ""}`}
            key={label}
          >
            <span>{index < current ? <Icon name="check" /> : index + 1}</span>
            <b>{label}</b>
            {detail && <small className="gen-detail">{detail}</small>}
            {index === current && <i />}
          </div>
        ))}
      </div>

      <div className="gen-progress">
        <span style={{ width: `${progress}%` }} />
      </div>

      <small>{progress}% · {run.events.length} events recorded</small>
    </section>
  );
}
