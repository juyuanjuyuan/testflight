import FrameView from "../components/FrameView";
import Icon, { type IconName } from "../components/Icon";
import type { AgentNode, RunState } from "../hooks/useRunStream";
import { clock, hostOf } from "../lib/format";

const nodes: { id: AgentNode; name: string; engine: string; icon: IconName }[] = [
  { id: "decider", name: "User agent", engine: "DeepSeek 2", icon: "user" },
  { id: "translator", name: "Translator", engine: "DeepSeek 1", icon: "terminal" },
  { id: "guard", name: "Guard", engine: "Validation", icon: "shield" },
  { id: "screenReader", name: "Screen reader", engine: "Guidepup", icon: "pulse" },
];

type FeedItem = {
  key: string;
  t: number;
  icon: IconName;
  agent: string;
  text: string;
  alert?: boolean;
};

function toFeed(run: RunState): FeedItem[] {
  const items: FeedItem[] = [];

  run.events.forEach((event, index) => {
    const key = `${index}-${event.type}`;

    switch (event.type) {
      case "turn.intent":
        items.push({ key, t: event.t, icon: "user", agent: `User agent · T${event.turn}`, text: event.text });
        break;
      case "turn.command":
        items.push({ key, t: event.t, icon: "terminal", agent: `Translator · T${event.turn}`, text: event.summary });
        break;
      case "turn.rejected":
        items.push({ key, t: event.t, icon: "refresh", agent: `Guard · T${event.turn}`, text: `Rejected: ${event.reason}`, alert: true });
        break;
      case "turn.executed":
        if (!event.ok) {
          items.push({ key, t: event.t, icon: "issue", agent: `Runner · T${event.turn}`, text: event.error ?? "Action failed", alert: true });
        }
        break;
      case "turn.heard":
        items.push({
          key,
          t: event.t,
          icon: "pulse",
          agent: `Screen reader · T${event.turn}`,
          text: event.announcements.length
            ? event.announcements.map((line) => `“${line}”`).join("  ")
            : "No new announcement",
          alert: event.announcements.length === 0,
        });
        break;
      case "run.ended":
        items.push({
          key,
          t: event.t,
          icon: event.outcome === "completed" ? "check" : "issue",
          agent: "Orchestrator",
          text:
            event.outcome === "completed"
              ? `Goal completed in ${event.turns} turns`
              : event.outcome === "blocked"
                ? `Task blocked after ${event.turns} turns`
                : `Turn budget exhausted (${event.turns})`,
          alert: event.outcome !== "completed",
        });
        break;
    }
  });

  return items.reverse();
}

export default function ScanScreen({
  run,
  isVerification,
  onSkip,
}: {
  run: RunState;
  isVerification: boolean;
  onSkip?: () => void;
}) {
  const progress = run.ended
    ? 100
    : Math.min(99, Math.round((run.turn / run.maxTurns) * 100));
  const feed = toFeed(run);
  const silent = run.lastHeard?.announcements.length === 0;

  return (
    <section className="scan-screen">
      <div className="scan-heading">
        <div>
          <span className="scan-kicker">
            <i />
            {isVerification ? "VERIFICATION RUN" : "LIVE AUTONOMOUS AUDIT"}
          </span>

          <h1>
            {isVerification
              ? "Re-running the same goal on the patched copy."
              : `Agents are navigating ${run.url ? hostOf(run.url) : "your site"}.`}
          </h1>

          <p>{run.goal ? `Goal: ${run.goal}` : "Starting a secure browser session…"}</p>
        </div>

        <div
          className="progress-ring"
          style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}
        >
          <div>
            <strong>{run.turn}</strong>
            <span>/{run.maxTurns}</span>
          </div>
        </div>
      </div>

      <div className="scan-layout">
        <div className="agent-stream">
          <div className="stream-head">
            <div>
              <span className="live-dot" />
              LIVE AGENT STREAM
            </div>

            <span>{feed.length} EVENTS</span>
          </div>

          <div className="agent-status-row">
            {nodes.map((node) => (
              <div className={run.activeNode === node.id ? "on" : ""} key={node.id}>
                <span>
                  <Icon name={node.icon} />
                </span>
                <b>{node.name}</b>
                <small>
                  {run.activeNode === node.id ? "Working" : node.engine}
                </small>
              </div>
            ))}
          </div>

          <div className="event-feed">
            {feed.length === 0 && (
              <div className="connecting">
                <span />
                Establishing secure browser session…
              </div>
            )}

            {feed.map((item, index) => (
              <div
                className={`event ${item.alert ? "alert" : ""} ${index === 0 ? "new" : ""}`}
                key={item.key}
              >
                <span className="event-time">{clock(item.t)}</span>

                <span className="event-icon">
                  <Icon name={item.icon} />
                </span>

                <div>
                  <b>{item.agent}</b>
                  <p>{item.text}</p>
                </div>

                {index === 0 && <i />}
              </div>
            ))}
          </div>
        </div>

        <div className="live-browser">
          <div className="browser-chrome">
            <div>
              <i />
              <i />
              <i />
            </div>

            <span>
              <Icon name="lock" size={11} />
              {run.latestFrame?.pageUrl ?? run.url ?? "about:blank"}
            </span>

            <Icon name="menu" size={15} />
          </div>

          <FrameView
            src={run.latestFrame?.screenshotUrl}
            focusBox={run.latestFrame?.focusBox}
            label="SR FOCUS"
            tone={silent ? "alert" : "focus"}
            viewport={run.viewport}
            alt="Latest screenshot from the agent's browser"
          />

          <div className={`heard-caption ${silent ? "silent" : ""}`}>
            <Icon name="pulse" size={14} />
            <span>
              {!run.lastHeard
                ? "Screen reader output will appear here"
                : silent
                  ? "(silence: nothing was announced)"
                  : run.lastHeard.announcements.join("  ·  ")}
            </span>
          </div>

          <div className="browser-footer">
            <span>
              <i />
              Browser isolated
            </span>
            <span>
              {run.viewport
                ? `Viewport ${run.viewport.width} × ${run.viewport.height}`
                : "Viewport —"}
            </span>
          </div>
        </div>
      </div>

      <div className="scan-progress-bar">
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="scan-footer">
        <span>
          {run.ended
            ? "Run finished. Analyzing evidence…"
            : `Turn ${run.turn} of up to ${run.maxTurns}`}
        </span>

        {onSkip && !run.ended && (
          <button type="button" onClick={onSkip}>
            Skip to results
            <Icon name="arrow" size={14} />
          </button>
        )}
      </div>
    </section>
  );
}
