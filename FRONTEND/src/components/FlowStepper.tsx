import Icon from "./Icon";

const flow = [
  "Connect",
  "Scan",
  "Report",
  "Inspect",
  "Fix",
  "Verify",
  "Comply",
];

export default function FlowStepper({
  active,
  onSelect,
}: {
  active: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flow-stepper" aria-label="Audit progress">
      {flow.map((label, index) => (
        <button
          type="button"
          className={`flow-step ${
            index === active ? "active" : ""
          } ${index < active ? "complete" : ""}`}
          key={label}
          disabled={index > active}
          aria-current={index === active ? "step" : undefined}
          onClick={() => onSelect(index)}
        >
          <span>
            {index < active ? (
              <Icon name="check" size={12} />
            ) : (
              index + 1
            )}
          </span>
          <small>{label}</small>
          {index < flow.length - 1 && <i />}
        </button>
      ))}
    </div>
  );
}
