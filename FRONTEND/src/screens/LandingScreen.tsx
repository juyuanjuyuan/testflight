import Icon from "../components/Icon";

export default function LandingScreen({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="landing-screen">
      <div className="landing-glow" aria-hidden="true" />

      <div className="cube-scene" aria-hidden="true">
        <div className="wire-cube">
          <span className="cube-face cube-front" />
          <span className="cube-face cube-back" />
          <span className="cube-face cube-right" />
          <span className="cube-face cube-left" />
          <span className="cube-face cube-top" />
          <span className="cube-face cube-bottom" />
        </div>

        <div className="cube-orbit cube-orbit-one" />
        <div className="cube-orbit cube-orbit-two" />
      </div>

      <h3 className="landing-hero">
        <span className="landing-title">ClearAccess</span>
        <span className="landing-subtitle">AI-powered web accessibility auditor</span>
      </h3>

      <button
        className="landing-enter"
        type="button"
        aria-label="Continue to website setup"
        onClick={onEnter}
      >
        <Icon name="arrow" size={24} />
      </button>
    </section>
  );
}
