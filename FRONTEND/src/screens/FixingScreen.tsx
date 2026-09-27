import Icon from "../components/Icon";

export default function FixingScreen({
  stages,
  current,
  findingId,
}: {
  stages: string[];
  /** 当前正在进行的阶段序号，-1 = 尚未开始 */
  current: number;
  findingId: string;
}) {
  const progress = Math.round((Math.max(0, current) / stages.length) * 100);

  return (
    <section className="generation-screen">
      <div className="generation-orb">
        <span />
        <Icon name="spark" size={34} />
      </div>

      <span className="gen-kicker">FIXER · CONSTRAINED EDITS</span>

      <h1>Building the smallest safe fix.</h1>

      <p>
        Reading the site copy, generating a patch, and checking it against the
        constraints.
      </p>

      <div className="gen-steps">
        {stages.map((label, index) => (
          <div
            className={`${index < current ? "done" : ""} ${index === current ? "active" : ""}`}
            key={label}
          >
            <span>{index < current ? <Icon name="check" /> : index + 1}</span>
            <b>{label}</b>
            {index === current && <i />}
          </div>
        ))}
      </div>

      <div className="gen-progress">
        <span style={{ width: `${progress}%` }} />
      </div>

      <small>
        {progress}% · {findingId}
      </small>
    </section>
  );
}
