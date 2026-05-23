import type { TrackingBackend } from "@incantation/shared/settings-schema";
import { LivePreview } from "./live-preview";

type CameraHudProps = {
  serviceRunning: boolean;
  trackingBackend: TrackingBackend;
  previewAvailable: boolean;
  cameraUnavailable: boolean;
  gesture: string;
  tracking: boolean;
  deviceName?: string;
  cameraWidth?: number;
  cameraHeight?: number;
  captureFps?: number;
  processedFps?: number;
  previewFps?: number;
  frameDelayMs?: number;
  overlayOnly?: boolean;
};

const formatMetric = (value: number | undefined, digits = 1) => {
  return value === undefined ? "--" : value.toFixed(digits);
};

const fpsTone = (value: number | undefined, baseline = 24) => {
  if (value === undefined) {
    return "muted";
  }
  if (value >= baseline) {
    return "good";
  }
  if (value >= baseline * 0.7) {
    return "warn";
  }
  return "bad";
};

const delayTone = (value: number | undefined) => {
  if (value === undefined) {
    return "muted";
  }
  if (value <= 35) {
    return "good";
  }
  if (value <= 60) {
    return "warn";
  }
  return "bad";
};

export const CameraHud = ({
  serviceRunning,
  trackingBackend,
  previewAvailable,
  cameraUnavailable,
  gesture,
  tracking,
  deviceName,
  cameraWidth,
  cameraHeight,
  captureFps,
  processedFps,
  previewFps,
  frameDelayMs,
  overlayOnly = false,
}: CameraHudProps) => {
  const processedBaseline = captureFps ?? 24;
  const backendLabel = trackingBackend === "leap" ? "Leap" : "Camera";
  const previewLabel = trackingBackend === "leap" ? "Leap" : "Webcam";

  return (
    <div className="camera-hud-shell">
      <section
        className={`camera-hud-panel ${overlayOnly ? "camera-hud-panel-overlay" : ""}`}
      >
        <div className="camera-hud-header">
          <div className="camera-hud-header-main">
            <div className="camera-hud-title-row">
              <div>
                <div className="eyebrow">{backendLabel} HUD</div>
                <strong>{tracking ? gesture : "searching"}</strong>
              </div>
              <div className="camera-hud-chip">
                {serviceRunning
                  ? !previewAvailable
                    ? "status only"
                    : cameraUnavailable
                      ? "camera issue"
                      : "live"
                  : "offline"}
              </div>
            </div>
            <div className="camera-hud-metrics">
              <span className="camera-hud-metric camera-hud-metric-neutral">
                {previewAvailable
                  ? `Camera ${cameraWidth ?? 0}x${cameraHeight ?? 0}`
                  : (deviceName ?? "Leap Motion Controller")}
              </span>
              {previewAvailable ? (
                <span
                  className={`camera-hud-metric camera-hud-metric-${fpsTone(captureFps)}`}
                >
                  Capture {formatMetric(captureFps)} fps
                </span>
              ) : null}
              <span
                className={`camera-hud-metric camera-hud-metric-${fpsTone(processedFps, processedBaseline)}`}
              >
                Processed {formatMetric(processedFps)} fps
              </span>
              {!overlayOnly ? (
                <span
                  className={`camera-hud-metric camera-hud-metric-${fpsTone(previewFps, processedFps ?? captureFps ?? 24)}`}
                >
                  Preview {formatMetric(previewFps)} fps
                </span>
              ) : null}
              <span
                className={`camera-hud-metric camera-hud-metric-${delayTone(frameDelayMs)}`}
              >
                Delay {frameDelayMs ?? 0} ms
              </span>
            </div>
          </div>
        </div>
        <LivePreview
          serviceRunning={serviceRunning}
          previewAvailable={previewAvailable}
          backendLabel={previewLabel}
          cameraUnavailable={cameraUnavailable}
          compact
        />
        {!overlayOnly ? (
          <p className="camera-hud-copy">
            {previewAvailable
              ? "Teal marks the pointer hand, amber marks the action hand, and the frame edge shows the live camera bounds."
              : "Leap currently feeds semantic hand state without a preview image, so use this HUD as a compact status surface."}
          </p>
        ) : null}
      </section>
    </div>
  );
};
