import Icon from "../components/Icon";

export default function SetupScreen({
  url,
  goal,
  busy,
  demo,
  onUrlChange,
  onGoalChange,
  onStart,
}: {
  url: string;
  goal: string;
  busy: boolean;
  demo: boolean;
  onUrlChange: (value: string) => void;
  onGoalChange: (value: string) => void;
  onStart: () => void;
}) {
  const ready = url.trim() !== "" && goal.trim() !== "" && !busy;

  return (
    <section className="connect-screen">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <form
        className="launch-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onStart();
        }}
      >
        <div className="launch-top">
          <div className="live-orb">
            <span />
            <Icon name="pulse" />
          </div>

          <div>
            <span>NEW AUDIT</span>
            <h2>What should we test?</h2>
          </div>
        </div>

        <label htmlFor="site-url">Website URL</label>

        <div className="url-field">
          <Icon name="globe" />

          <input
            id="site-url"
            type="url"
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="https://your-site.com"
            required
          />

          <span>SECURE</span>
        </div>

        <label htmlFor="goal">Task goal</label>

        <div className="goal-field">
          <Icon name="spark" />

          <input
            id="goal"
            value={goal}
            onChange={(event) => onGoalChange(event.target.value)}
            placeholder="What should a screen reader user be able to do?"
            required
          />
        </div>

        <button className="hero-button" type="submit" disabled={!ready}>
          <span>{busy ? "Starting…" : "Start autonomous audit"}</span>
          <Icon name="arrow" />
        </button>

        <p className="launch-note">
          <Icon name="lock" size={13} />
          {demo
            ? "Demo mode: replaying a recorded run. Set VITE_API_BASE to go live."
            : "No scripts installed. AccessRun browses as an external visitor."}
        </p>
      </form>
    </section>
  );
}
