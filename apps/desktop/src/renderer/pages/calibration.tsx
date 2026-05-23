import type {
  AirloomCaptureStateEvent,
  AirloomStatusDebug,
} from "@incantation/shared/gesture-events";
import type { TrackingBackend } from "@incantation/shared/settings-schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LivePreview } from "../components/live-preview";

const captureLabels = [
  "neutral",
  "open-palm",
  "blade-hand",
  "closed-fist",
  "primary-pinch",
  "secondary-pinch",
  "peace-sign",
] as const;

const captureDurationOptions = [1000, 1500, 2000, 2500] as const;

const labelHotkeys: Record<(typeof captureLabels)[number], string> = {
  neutral: "a",
  "open-palm": "s",
  "closed-fist": "d",
  "blade-hand": "j",
  "primary-pinch": "f",
  "secondary-pinch": "g",
  "peace-sign": "h",
};

const durationHotkeys: Record<number, string> = {
  1000: "1",
  1500: "2",
  2000: "3",
  2500: "4",
};

const randomSandboxTarget = () => ({
  x: 10 + Math.random() * 70,
  y: 10 + Math.random() * 70,
});

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
};

const handSideLabel = (value?: string) => {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized.includes("left")) {
    return "left";
  }
  if (normalized.includes("right")) {
    return "right";
  }
  return null;
};

const formatLandmark = (point?: { x: number; y: number }) => {
  if (!point) {
    return "-";
  }

  return `${point.x.toFixed(2)}, ${point.y.toFixed(2)}`;
};

type CalibrationProps = {
  serviceRunning: boolean;
  tracking: boolean;
  gesture: string;
  trackingBackend: TrackingBackend;
  previewAvailable: boolean;
  pinchStrength: number;
  pointerControlEnabled: boolean;
  pushToTalkGesture: string;
  pushToTalkKey: string;
  debug: AirloomStatusDebug;
  capture: AirloomCaptureStateEvent;
  onCaptureLabelChange: (label: string) => Promise<unknown>;
  onCaptureStart: () => Promise<unknown>;
  onCaptureStop: () => Promise<unknown>;
  onDiscardLastCapture: () => Promise<unknown>;
  onExportCaptures: () => Promise<unknown>;
  primaryPinchActive: boolean;
  primaryPinchHeldMs: number;
  primaryPinchOutcome: "idle" | "click" | "drag";
  commandModeActive: boolean;
  commandModeSubmode: "idle" | "right-click" | "scroll" | "workspace";
  commandDeltaX: number;
  commandDeltaY: number;
  workspaceDirection: "idle" | "previous" | "next";
};

export const CalibrationPage = ({
  serviceRunning,
  tracking,
  gesture,
  trackingBackend,
  previewAvailable,
  pinchStrength,
  pointerControlEnabled,
  pushToTalkGesture,
  pushToTalkKey,
  debug,
  capture,
  onCaptureLabelChange,
  onCaptureStart,
  onCaptureStop,
  onDiscardLastCapture,
  onExportCaptures,
  primaryPinchActive,
  primaryPinchHeldMs,
  primaryPinchOutcome,
  commandModeActive,
  commandModeSubmode,
  commandDeltaX,
  commandDeltaY,
  workspaceDirection,
}: CalibrationProps) => {
  const [countdown, setCountdown] = useState<number | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const captureStartRef = useRef(onCaptureStart);
  const captureStopRef = useRef(onCaptureStop);
  const discardLastRef = useRef(onDiscardLastCapture);
  const exportCapturesRef = useRef(onExportCaptures);
  const changeLabelRef = useRef(onCaptureLabelChange);
  const [captureDurationMs, setCaptureDurationMs] = useState<number>(1500);
  const [sandboxHits, setSandboxHits] = useState(0);
  const [sandboxMisses, setSandboxMisses] = useState(0);
  const [sandboxTarget, setSandboxTarget] = useState(randomSandboxTarget);
  const [speechDraft, setSpeechDraft] = useState(
    "Focus here, then hold your speech gesture and dictate a short sentence.",
  );
  const progress =
    primaryPinchOutcome === "drag" ? 1 : primaryPinchActive ? 0.45 : 0;
  const sandboxAttempts = sandboxHits + sandboxMisses;
  const sandboxAccuracy =
    sandboxAttempts === 0
      ? 0
      : Math.round((sandboxHits / sandboxAttempts) * 100);
  const actionPoseScores = debug.actionPoseScores ?? debug.poseScores;
  const captureSupported = trackingBackend === "webcam";
  const backendLabel = trackingBackend === "leap" ? "Leap" : "Webcam";
  const pointerSide = handSideLabel(debug.pointerHand);
  const actionSide = handSideLabel(debug.actionHand);
  const pointerPanelClassName = [
    "hand-debug-panel",
    "hand-debug-panel-pointer",
    pointerSide === "right" ? "hand-debug-panel-right" : "",
    pointerSide === "left" ? "hand-debug-panel-left" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const actionPanelClassName = [
    "hand-debug-panel",
    "hand-debug-panel-action",
    actionSide === "right" ? "hand-debug-panel-right" : "",
    actionSide === "left" ? "hand-debug-panel-left" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const brightnessLabel = useMemo(() => {
    if (trackingBackend === "leap") {
      return "Sensor";
    }
    if (debug.brightness < 0.18) {
      return "Very dark";
    }

    if (debug.brightness < 0.3) {
      return "Dim";
    }

    if (debug.brightness < 0.55) {
      return "Usable";
    }

    return "Bright";
  }, [debug.brightness, trackingBackend]);

  useEffect(() => {
    captureStartRef.current = onCaptureStart;
  }, [onCaptureStart]);

  useEffect(() => {
    captureStopRef.current = onCaptureStop;
  }, [onCaptureStop]);

  useEffect(() => {
    discardLastRef.current = onDiscardLastCapture;
  }, [onDiscardLastCapture]);

  useEffect(() => {
    exportCapturesRef.current = onExportCaptures;
  }, [onExportCaptures]);

  useEffect(() => {
    changeLabelRef.current = onCaptureLabelChange;
  }, [onCaptureLabelChange]);

  useEffect(() => {
    return () => {
      void window.incantation.setInputSuppressed(false);
    };
  }, []);

  useEffect(() => {
    if (countdown === null) {
      return;
    }
    if (countdown <= 0) {
      captureStartRef
        .current()
        .catch(() => window.incantation.setInputSuppressed(false))
        .finally(() => {
          setCountdown(null);
          setCaptureBusy(false);
        });
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown(countdown - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (!capture.recording) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCaptureBusy(true);
      captureStopRef
        .current()
        .finally(() => window.incantation.setInputSuppressed(false))
        .finally(() => setCaptureBusy(false));
    }, captureDurationMs);

    return () => window.clearTimeout(timer);
  }, [capture.recording, captureDurationMs]);

  const startCapture = useCallback(async () => {
    setCaptureBusy(true);
    await window.incantation.setInputSuppressed(true);
    setCountdown(3);
  }, []);

  const stopCapture = useCallback(async () => {
    setCaptureBusy(true);
    await onCaptureStop();
    await window.incantation.setInputSuppressed(false);
    setCaptureBusy(false);
  }, [onCaptureStop]);

  const resetSandbox = useCallback(() => {
    setSandboxHits(0);
    setSandboxMisses(0);
    setSandboxTarget(randomSandboxTarget());
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "escape") {
        if (countdown !== null) {
          event.preventDefault();
          setCountdown(null);
          setCaptureBusy(false);
          void window.incantation.setInputSuppressed(false);
          return;
        }

        if (capture.recording && !captureBusy) {
          event.preventDefault();
          void stopCapture();
        }
        return;
      }

      const labelEntry = Object.entries(labelHotkeys).find(
        ([, hotkey]) => hotkey === key,
      );
      if (
        labelEntry &&
        captureSupported &&
        !capture.recording &&
        !captureBusy &&
        countdown === null
      ) {
        event.preventDefault();
        void changeLabelRef.current(labelEntry[0]);
        return;
      }

      const durationEntry = Object.entries(durationHotkeys).find(
        ([, hotkey]) => hotkey === key,
      );
      if (
        durationEntry &&
        captureSupported &&
        !capture.recording &&
        !captureBusy &&
        countdown === null
      ) {
        event.preventDefault();
        setCaptureDurationMs(Number(durationEntry[0]));
        return;
      }

      if (key === " " || key === "enter") {
        event.preventDefault();
        if (!captureSupported || !serviceRunning || captureBusy) {
          return;
        }
        if (countdown !== null) {
          setCountdown(null);
          setCaptureBusy(false);
          void window.incantation.setInputSuppressed(false);
          return;
        }
        if (capture.recording) {
          void stopCapture();
          return;
        }
        void startCapture();
        return;
      }

      if (
        captureSupported &&
        key === "backspace" &&
        !capture.recording &&
        !captureBusy &&
        capture.takeCount > 0
      ) {
        event.preventDefault();
        setCaptureBusy(true);
        void discardLastRef.current().finally(() => setCaptureBusy(false));
        return;
      }

      if (
        captureSupported &&
        key === "e" &&
        !capture.recording &&
        !captureBusy &&
        capture.takeCount > 0
      ) {
        event.preventDefault();
        setCaptureBusy(true);
        void exportCapturesRef.current().finally(() => setCaptureBusy(false));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    capture.recording,
    capture.takeCount,
    captureBusy,
    countdown,
    captureSupported,
    serviceRunning,
    startCapture,
    stopCapture,
  ]);

  return (
    <section className="panel">
      <div className="eyebrow">Calibration</div>
      <h2>Live signal, capture, and testing</h2>
      <div className="calibration-layout">
        <div className="calibration-main">
          <div className="metric-grid calibration-summary-grid">
            <div className="metric-card">
              <span>Backend</span>
              <strong>{backendLabel}</strong>
            </div>
            <div className="metric-card">
              <span>Tracking</span>
              <strong>{tracking ? "Active" : "Searching"}</strong>
            </div>
            <div className="metric-card">
              <span>Gesture</span>
              <strong>{gesture}</strong>
            </div>
            <div className="metric-card">
              <span>Pointer</span>
              <strong>
                {pointerControlEnabled ? "Hold-to-move" : "Frozen"}
              </strong>
            </div>
            <div className="metric-card">
              <span>Confidence</span>
              <strong>{debug.confidence.toFixed(2)}</strong>
            </div>
            <div className="metric-card">
              <span>
                {trackingBackend === "webcam" ? "Scene light" : "Sensor"}
              </span>
              <strong>
                {trackingBackend === "webcam"
                  ? `${brightnessLabel} (${debug.brightness.toFixed(2)})`
                  : (debug.deviceName ?? "Leap Motion Controller")}
              </strong>
            </div>
            <div className="metric-card">
              <span>Frame delay</span>
              <strong>{debug.frameDelayMs} ms</strong>
            </div>
            <div className="metric-card">
              <span>Classifier</span>
              <strong>{debug.classifierMode}</strong>
            </div>
            <div className="metric-card">
              <span>Model</span>
              <strong>{debug.modelVersion ?? "rules only"}</strong>
            </div>
          </div>

          <div className="hand-debug-sections">
            <section className={pointerPanelClassName}>
              <div className="hand-debug-header">
                <div>
                  <div className="eyebrow">Pointer side</div>
                  <h3>
                    {pointerSide === "right"
                      ? "Right hand"
                      : pointerSide === "left"
                        ? "Left hand"
                        : "Pointer hand"}
                  </h3>
                </div>
                <div className="hand-debug-chip">
                  Pointer · {debug.pointerHand ?? "unknown"}
                </div>
              </div>
              <div className="metric-grid hand-debug-grid">
                <div className="metric-card">
                  <span>Pose</span>
                  <strong>
                    {debug.pose} ({debug.poseConfidence.toFixed(2)})
                  </strong>
                </div>
                <div className="metric-card">
                  <span>Primary</span>
                  <strong>
                    {debug.poseScores["primary-pinch"].toFixed(2)}
                  </strong>
                </div>
                <div className="metric-card">
                  <span>Fist</span>
                  <strong>{debug.poseScores["closed-fist"].toFixed(2)}</strong>
                </div>
                <div className="metric-card">
                  <span>Palm</span>
                  <strong>{debug.poseScores["open-palm"].toFixed(2)}</strong>
                </div>
                <div className="metric-card">
                  <span>Peace</span>
                  <strong>
                    {(debug.poseScores["peace-sign"] ?? 0).toFixed(2)}
                  </strong>
                </div>
                <div className="metric-card">
                  <span>Neutral</span>
                  <strong>{debug.poseScores.neutral.toFixed(2)}</strong>
                </div>
                <div className="metric-card">
                  <span>Closed fist</span>
                  <strong>{debug.closedFist ? "Seen" : "No"}</strong>
                </div>
                <div className="metric-card">
                  <span>Fist frames</span>
                  <strong>{debug.closedFistFrames}</strong>
                </div>
                <div className="metric-card">
                  <span>Fist latched</span>
                  <strong>{debug.closedFistLatched ? "Yes" : "No"}</strong>
                </div>
              </div>
            </section>

            <section className={actionPanelClassName}>
              <div className="hand-debug-header">
                <div>
                  <div className="eyebrow">Action side</div>
                  <h3>
                    {actionSide === "right"
                      ? "Right hand"
                      : actionSide === "left"
                        ? "Left hand"
                        : "Action hand"}
                  </h3>
                </div>
                <div className="hand-debug-chip">
                  Action · {debug.actionHand ?? "unknown"}
                </div>
              </div>
              <div className="metric-grid hand-debug-grid">
                <div className="metric-card">
                  <span>Pose</span>
                  <strong>
                    {debug.actionPose ?? debug.pose} (
                    {(
                      debug.actionPoseConfidence ?? debug.poseConfidence
                    ).toFixed(2)}
                    )
                  </strong>
                </div>
                <div className="metric-card">
                  <span>Primary</span>
                  <strong>
                    {actionPoseScores["primary-pinch"].toFixed(2)}
                  </strong>
                </div>
                <div className="metric-card">
                  <span>Secondary</span>
                  <strong>{debug.secondaryPinchStrength.toFixed(2)}</strong>
                </div>
                <div className="metric-card">
                  <span>Command mode</span>
                  <strong>
                    {commandModeActive ? commandModeSubmode : "idle"}
                  </strong>
                </div>
                <div className="metric-card">
                  <span>Palm</span>
                  <strong>{actionPoseScores["open-palm"].toFixed(2)}</strong>
                </div>
                <div className="metric-card">
                  <span>Peace</span>
                  <strong>
                    {(actionPoseScores["peace-sign"] ?? 0).toFixed(2)}
                  </strong>
                </div>
                <div className="metric-card">
                  <span>Neutral</span>
                  <strong>{actionPoseScores.neutral.toFixed(2)}</strong>
                </div>
                <div className="metric-card">
                  <span>Pinch</span>
                  <strong>{pinchStrength.toFixed(2)}</strong>
                </div>
                <div className="metric-card">
                  <span>Open palm</span>
                  <strong>{debug.openPalmHold ? "Seen" : "No"}</strong>
                </div>
                <div className="metric-card">
                  <span>Command delta</span>
                  <strong>
                    {commandDeltaX.toFixed(2)}, {commandDeltaY.toFixed(2)}
                  </strong>
                </div>
              </div>
            </section>
          </div>

          <div className="metric-grid calibration-summary-grid">
            <div className="metric-card">
              <span>Fist release</span>
              <strong>{debug.closedFistReleaseFrames}</strong>
            </div>
            <div className="metric-card">
              <span>Pinch hold</span>
              <strong>{primaryPinchHeldMs} ms</strong>
            </div>
            <div className="metric-card">
              <span>Hold active</span>
              <strong>{primaryPinchActive ? "Yes" : "No"}</strong>
            </div>
            <div className="metric-card">
              <span>Command hold</span>
              <strong>
                {commandModeActive || debug.secondaryPinchActive ? "Yes" : "No"}
              </strong>
            </div>
            <div className="metric-card">
              <span>Workspace dir</span>
              <strong>{workspaceDirection}</strong>
            </div>
            <div className="metric-card">
              <span>Click preview</span>
              <strong>{primaryPinchOutcome}</strong>
            </div>
            {debug.learnedPose ? (
              <div className="metric-card">
                <span>Learned pose</span>
                <strong>
                  {debug.learnedPose} (
                  {(debug.learnedPoseConfidence ?? 0).toFixed(2)})
                </strong>
              </div>
            ) : null}
            {debug.shadowDisagreement !== undefined ? (
              <div className="metric-card">
                <span>Shadow mismatch</span>
                <strong>{debug.shadowDisagreement ? "Yes" : "No"}</strong>
              </div>
            ) : null}
            {debug.fallbackReason ? (
              <div className="metric-card">
                <span>Fallback</span>
                <strong>{debug.fallbackReason}</strong>
              </div>
            ) : null}
          </div>
          {trackingBackend === "leap" ? (
            <>
              <div className="metric-grid calibration-summary-grid">
                <div className="metric-card">
                  <span>Pointer mode</span>
                  <strong>{debug.leapPointerMode ?? "free"}</strong>
                </div>
                <div className="metric-card">
                  <span>Control raw</span>
                  <strong>{formatLandmark(debug.leapControlPointer)}</strong>
                </div>
                <div className="metric-card">
                  <span>Preview palm</span>
                  <strong>{formatLandmark(debug.leapPreviewPointer)}</strong>
                </div>
                <div className="metric-card">
                  <span>Clutch anchor</span>
                  <strong>
                    {formatLandmark(debug.leapPreviewClutchAnchor)}
                  </strong>
                </div>
                <div className="metric-card">
                  <span>Clutch delta</span>
                  <strong>
                    {(debug.leapClutchDeltaX ?? 0).toFixed(2)},{" "}
                    {(debug.leapClutchDeltaY ?? 0).toFixed(2)}
                  </strong>
                </div>
                <div className="metric-card">
                  <span>Range</span>
                  <strong>
                    x {Math.round(debug.leapPointerMinX ?? 0)}..
                    {Math.round(debug.leapPointerMaxX ?? 0)} / z{" "}
                    {Math.round(debug.leapPointerMinZ ?? 0)}..
                    {Math.round(debug.leapPointerMaxZ ?? 0)}
                  </strong>
                </div>
              </div>
              <p className="panel-copy">
                Blue ring = clutch anchor. Blue arrow = palm delta while the
                fist clutch is active. Use these numbers to tune Leap mapping
                before changing gesture semantics.
              </p>
            </>
          ) : null}
          <p className="panel-copy">
            Cursor motion is frozen unless you actively hold a closed fist. Open
            palm and pinch gestures keep the cursor parked in place while they
            fire.
          </p>
          {trackingBackend === "webcam" ? (
            <p className="panel-copy">
              If scene light stays in the dim range or confidence drops while
              your hand is clearly visible, low light is probably hurting
              detection.
            </p>
          ) : (
            <p className="panel-copy">
              Leap has no camera-light metric, so prioritize clean two-hand
              visibility, comfortable device placement, and stable re-entry when
              tracking drops.
            </p>
          )}
          <p className="panel-copy">
            If a pinch feels ignored, compare the primary score against the
            fist, palm, and neutral scores to see which pose the classifier
            nearly chose.
          </p>

          <div className="calibration-ritual-card">
            <div className="eyebrow">Capture</div>
            <h3>Capture dataset</h3>
            <p className="panel-copy">
              {captureSupported
                ? "Record deliberate labeled poses so the model learns your real working hand shapes instead of only perfect poses under ideal conditions."
                : "Capture export is webcam-only right now because the current training pipeline stores MediaPipe-style landmarks rather than Leap skeletal frames."}
            </p>
            <div className="metric-grid compact">
              <div className="metric-card">
                <span>Session</span>
                <strong>{capture.sessionId}</strong>
              </div>
              <div className="metric-card">
                <span>Active label</span>
                <strong>{capture.activeLabel}</strong>
              </div>
              <div className="metric-card">
                <span>Takes</span>
                <strong>{capture.takeCount}</strong>
              </div>
              <div className="metric-card">
                <span>Recording</span>
                <strong>
                  {capture.recording
                    ? "Yes"
                    : countdown
                      ? `Countdown (${countdown})`
                      : "No"}
                </strong>
              </div>
              <div className="metric-card">
                <span>Auto-stop</span>
                <strong>{(captureDurationMs / 1000).toFixed(1)} s</strong>
              </div>
            </div>
            <div className="panel-copy">
              {captureLabels.map((label) => (
                <label
                  key={label}
                  style={{
                    display: "inline-flex",
                    gap: "0.35rem",
                    marginRight: "1rem",
                  }}
                >
                  <input
                    type="radio"
                    name="capture-label"
                    value={label}
                    checked={capture.activeLabel === label}
                    disabled={
                      !captureSupported || capture.recording || captureBusy
                    }
                    onChange={() => {
                      void onCaptureLabelChange(label);
                    }}
                  />
                  <span>
                    {label} ({capture.counts[label]})
                  </span>
                </label>
              ))}
            </div>
            <div className="panel-copy">
              {captureDurationOptions.map((durationMs) => (
                <label
                  key={durationMs}
                  style={{
                    display: "inline-flex",
                    gap: "0.35rem",
                    marginRight: "1rem",
                  }}
                >
                  <input
                    type="radio"
                    name="capture-duration"
                    value={durationMs}
                    checked={captureDurationMs === durationMs}
                    disabled={
                      !captureSupported ||
                      capture.recording ||
                      countdown !== null ||
                      captureBusy
                    }
                    onChange={() => setCaptureDurationMs(durationMs)}
                  />
                  <span>{(durationMs / 1000).toFixed(1)}s</span>
                </label>
              ))}
            </div>
            <div className="hero-actions">
              <button
                type="button"
                disabled={
                  !captureSupported ||
                  !serviceRunning ||
                  capture.recording ||
                  captureBusy
                }
                onClick={() => {
                  void startCapture();
                }}
              >
                {countdown
                  ? `Recording in ${countdown}`
                  : "Record labeled take"}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={
                  !captureSupported ||
                  (!capture.recording && countdown === null) ||
                  captureBusy
                }
                onClick={() => {
                  if (countdown !== null) {
                    setCountdown(null);
                    setCaptureBusy(false);
                    void window.incantation.setInputSuppressed(false);
                    return;
                  }
                  void stopCapture();
                }}
              >
                {countdown !== null ? "Cancel countdown" : "Stop capture"}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={
                  !captureSupported ||
                  capture.takeCount === 0 ||
                  capture.recording ||
                  captureBusy
                }
                onClick={() => {
                  setCaptureBusy(true);
                  void onDiscardLastCapture().finally(() =>
                    setCaptureBusy(false),
                  );
                }}
              >
                Discard last take
              </button>
              <button
                type="button"
                className="ghost"
                disabled={
                  !captureSupported ||
                  capture.takeCount === 0 ||
                  capture.recording ||
                  captureBusy
                }
                onClick={() => {
                  setCaptureBusy(true);
                  void onExportCaptures().finally(() => setCaptureBusy(false));
                }}
              >
                Export captures
              </button>
            </div>
            {capture.message ? (
              <p className="panel-copy">{capture.message}</p>
            ) : null}
            {capture.exportPath ? (
              <p className="panel-copy">Last export: {capture.exportPath}</p>
            ) : null}
            <p className="panel-copy">
              Each take auto-stops after {(captureDurationMs / 1000).toFixed(1)}{" "}
              seconds, so you can form the pose and hold it without touching the
              mouse.
            </p>
            <p className="panel-copy">
              Keyboard: `A` neutral, `S` open palm, `D` closed fist, `F` primary
              pinch, `G` secondary pinch, `H` peace sign, `J` blade hand, `1-4`
              duration, `Space`/`Enter` start, `Esc` stop or cancel, `Backspace`
              discard, `E` export.
            </p>
          </div>

          <div className="calibration-ritual-card sandbox-panel">
            <div className="eyebrow">Sandbox</div>
            <h3>Click precision</h3>
            <p className="panel-copy">
              Rehearse deliberate left-click hits so you can feel whether
              clutch, command mode, and click release timing are staying
              distinct.
            </p>
            <div className="metric-grid compact">
              <div className="metric-card">
                <span>Hits</span>
                <strong>{sandboxHits}</strong>
              </div>
              <div className="metric-card">
                <span>Misses</span>
                <strong>{sandboxMisses}</strong>
              </div>
              <div className="metric-card">
                <span>Accuracy</span>
                <strong>{sandboxAccuracy}%</strong>
              </div>
            </div>
            <div
              className="click-sandbox click-sandbox-wide"
              onPointerDown={() => setSandboxMisses((current) => current + 1)}
            >
              <button
                type="button"
                className="sandbox-target"
                style={{
                  left: `${sandboxTarget.x}%`,
                  top: `${sandboxTarget.y}%`,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  setSandboxHits((current) => current + 1);
                  setSandboxTarget(randomSandboxTarget());
                }}
                aria-label="Precision click target"
              >
                Hit
              </button>
            </div>
            <div className="hero-actions">
              <button type="button" className="ghost" onClick={resetSandbox}>
                Reset sandbox
              </button>
            </div>
            <p className="panel-copy camera-note">
              Try landing left clicks on the moving square. Hits count when the
              square is clicked; misses count when the sandbox background is
              clicked.
            </p>
          </div>

          <div className="calibration-ritual-card">
            <div className="eyebrow">Push to talk</div>
            <h3>Hold timing and spoken test</h3>
            <p className="panel-copy">
              Watch primary pinch stay in click mode until clutch motion turns
              it into a drag, then test push-to-talk end to end without leaving
              calibration.
            </p>
            <div className="hold-preview">
              <div className="hold-preview-copy">
                <span>Primary pinch hold</span>
                <strong>{primaryPinchHeldMs} ms</strong>
              </div>
              <div className="hold-track" aria-hidden="true">
                <div
                  className={`hold-fill hold-fill-${primaryPinchOutcome}`}
                  style={{
                    width: `${Math.max(progress * 100, primaryPinchActive ? 6 : 0)}%`,
                  }}
                />
              </div>
            </div>
            <p className="panel-copy">
              Primary pinch clicks on release by default. Drag only begins once
              you move the clutch while pinch stays held, secondary pinch stays
              reserved for right click and workspace, and blade hand handles
              direct scroll.
            </p>

            <div className="speech-sandbox-panel">
              <p className="panel-copy">
                Focus this field, then hold <strong>{pushToTalkGesture}</strong>{" "}
                to send
                <strong> {pushToTalkKey}</strong> through your normal
                speech-to-text stack.
              </p>
              <textarea
                className="speech-sandbox-editor"
                value={speechDraft}
                onChange={(event) => setSpeechDraft(event.target.value)}
                placeholder="Dictated text should land here while the field stays focused."
                spellCheck={false}
                rows={8}
              />
              <div className="hero-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setSpeechDraft("")}
                >
                  Clear transcript
                </button>
              </div>
              <p className="panel-copy camera-note">
                This is just a local text field for end-to-end testing, so you
                can verify focus, key hold, dictated text, and clean release
                without leaving calibration.
              </p>
            </div>
          </div>
        </div>
        <aside className="calibration-side">
          <div className="eyebrow">{backendLabel}</div>
          <h2>{previewAvailable ? "Live preview" : "Backend status"}</h2>
          <div className="camera-card">
            <LivePreview
              serviceRunning={serviceRunning}
              previewAvailable={previewAvailable}
              backendLabel={backendLabel}
              cameraUnavailable={
                trackingBackend === "webcam" && gesture === "camera-unavailable"
              }
            />
            <p className="panel-copy camera-note">
              {previewAvailable
                ? "This preview is sourced from the Python vision service, so it reflects the actual camera frames the backend is processing. Teal dots show detected landmarks, amber marks the raw index pointer, and coral marks the smoothed pointer output."
                : "Leap currently reports status without a camera preview. Use the pose, confidence, hand-role, and fallback panels here to tune behavior while the sensor stays live."}
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
};
