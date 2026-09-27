import { useState } from "react";
import type { Box } from "../api/types";

/** 证据记录器的截图，叠加读屏器焦点框。容器锁定视口宽高比，focusBox 的比例坐标才能对齐 */
export default function FrameView({
  src,
  focusBox,
  label,
  tone = "focus",
  viewport = { width: 1440, height: 900 },
  alt,
}: {
  src?: string;
  focusBox?: Box;
  label?: string;
  tone?: "focus" | "alert" | "resolved";
  viewport?: { width: number; height: number };
  alt: string;
}) {
  const aspectRatio = `${viewport.width} / ${viewport.height}`;
  const [failedSrc, setFailedSrc] = useState<string | undefined>();

  if (src && failedSrc === src) return <div className="frame-view empty" style={{ aspectRatio }}>Screenshot unavailable.</div>;

  if (!src) {
    return (
      <div className="frame-view empty" style={{ aspectRatio }}>
        <div className="connecting">
          <span />
          Waiting for the first screenshot…
        </div>
      </div>
    );
  }

  return (
    <div className="frame-view" style={{ aspectRatio }}>
      <img src={src} alt={alt} onError={() => setFailedSrc(src)} />

      {focusBox && (
        <div
          className={`focus-box ${tone}`}
          style={{
            left: `${focusBox[0] * 100}%`,
            top: `${focusBox[1] * 100}%`,
            width: `${focusBox[2] * 100}%`,
            height: `${focusBox[3] * 100}%`,
          }}
        >
          {label && <span>{label}</span>}
        </div>
      )}
    </div>
  );
}
