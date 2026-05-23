import type {
  AirloomCaptureStateEvent,
  AirloomInputEvent,
  AirloomStatusDebug,
} from "@incantation/shared/gesture-events";
import type { AirloomSettings } from "@incantation/shared/settings-schema";
import {
  type FocusEvent,
  type FormEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CameraHud } from "./components/camera-hud";
import { CommandHud } from "./components/command-hud";
import { CalibrationPage } from "./pages/calibration";
import { SettingsPage } from "./pages/settings";

type RuntimeState = {
  tracking: boolean;
  gesture: string;
  pinchStrength: number;
  pointerControlEnabled: boolean;
  inputSuppressed: boolean;
  recentActions: string[];
  debug: AirloomStatusDebug;
  mapper: {
    pointerControlEnabled: boolean;
    primaryPinchActive: boolean;
    primaryPinchHeldMs: number;
    primaryPinchOutcome: "idle" | "click" | "drag";
    commandModeActive: boolean;
    commandModeSubmode: "idle" | "right-click" | "scroll" | "workspace";
    commandDeltaX: number;
    commandDeltaY: number;
    workspaceDirection: "idle" | "previous" | "next";
  };
  lastError: string | null;
};

type InspectorLogEntry = {
  target: string;
  type: string;
  detail: number;
  which: number | null;
  button: number | null;
  buttons: number | null;
  elapsedMs: number;
};

type ServiceStatus = {
  running: boolean;
  adapter: string;
  lastEvent: AirloomInputEvent | null;
  runtime: RuntimeState;
  capture: AirloomCaptureStateEvent;
  debugRecording: {
    recording: boolean;
    sessionPath: string | null;
    frames: number;
    events: number;
  };
  warnings: string[];
};

declare global {
  interface Window {
    incantation: {
      getStatus: () => Promise<ServiceStatus>;
      getSettings: () => Promise<AirloomSettings>;
      updateSettings: (payload: AirloomSettings) => Promise<AirloomSettings>;
      startService: () => Promise<ServiceStatus>;
      stopService: () => Promise<ServiceStatus>;
      setInputSuppressed: (suppressed: boolean) => Promise<ServiceStatus>;
      setCaptureLabel: (label: string) => Promise<ServiceStatus>;
      startCapture: () => Promise<ServiceStatus>;
      stopCapture: () => Promise<ServiceStatus>;
      discardLastCapture: () => Promise<ServiceStatus>;
      exportCaptures: () => Promise<ServiceStatus>;
      startDebugRecording: () => Promise<ServiceStatus>;
      stopDebugRecording: () => Promise<ServiceStatus>;
      sendEvent: (payload: AirloomInputEvent) => Promise<ServiceStatus>;
      onStatus: (listener: (value: ServiceStatus) => void) => () => void;
      onPreviewFrame: (listener: (value: Uint8Array) => void) => () => void;
    };
  }
}

const initialStatus: ServiceStatus = {
  running: false,
  adapter: "unknown",
  lastEvent: null,
  runtime: {
    tracking: false,
    gesture: "idle",
    pinchStrength: 0,
    pointerControlEnabled: false,
    inputSuppressed: false,
    recentActions: [],
    debug: {
      trackingBackend: "webcam",
      previewAvailable: true,
      confidence: 0,
      brightness: 0,
      frameDelayMs: 0,
      pose: "unknown",
      poseConfidence: 0,
      poseScores: {
        neutral: 0,
        "open-palm": 0,
        "blade-hand": 0,
        "closed-fist": 0,
        "primary-pinch": 0,
        "secondary-pinch": 0,
        "peace-sign": 0,
      },
      classifierMode: "learned",
      modelVersion: null,
      closedFist: false,
      closedFistFrames: 0,
      closedFistReleaseFrames: 0,
      closedFistLatched: false,
      openPalmHold: false,
      secondaryPinchStrength: 0,
      bladeHandActive: false,
      bladeHandScore: 0,
      bladeScrollDeltaY: 0,
      bladeScrollAccumulated: 0,
    },
    mapper: {
      pointerControlEnabled: false,
      primaryPinchActive: false,
      primaryPinchHeldMs: 0,
      primaryPinchOutcome: "idle",
      commandModeActive: false,
      commandModeSubmode: "idle",
      commandDeltaX: 0,
      commandDeltaY: 0,
      workspaceDirection: "idle",
    },
    lastError: null,
  },
  capture: {
    type: "capture.state",
    sessionId: "pending",
    activeLabel: "neutral",
    recording: false,
    takeCount: 0,
    counts: {
      neutral: 0,
      "open-palm": 0,
      "blade-hand": 0,
      "closed-fist": 0,
      "primary-pinch": 0,
      "secondary-pinch": 0,
      "peace-sign": 0,
    },
    lastTakeId: null,
    exportPath: null,
    message: null,
  },
  debugRecording: {
    recording: false,
    sessionPath: null,
    frames: 0,
    events: 0,
  },
  warnings: [],
};

const defaultSettings: AirloomSettings = {
  trackingBackend: "webcam",
  leapOrientation: "normal",
  smoothing: 0.5,
  pointerRegionMargin: 0.08,
  clickPinchThreshold: 0.78,
  dragStartDeadzone: 0.015,
  bladeHandScrollEnabled: true,
  bladeHandScrollDeadzone: 0.01,
  bladeHandScrollGain: 72,
  bladeHandScrollActivationFrames: 2,
  bladeHandScrollReleaseFrames: 2,
  rightClickGesture: "thumb-middle-pinch",
  workspacePreviousKey: "",
  workspaceNextKey: "",
  commandHudPosition: "top-right",
  cameraHudPosition: "top-left",
  commandModeRightClickDeadzone: 0.04,
  commandModeMiddleClickTapMs: 180,
  commandModeScrollDeadzone: 0.05,
  commandModeScrollFastThreshold: 0.14,
  commandModeScrollGain: 32,
  commandModeWorkspaceThreshold: 0.08,
  commandModeWorkspaceStep: 0.12,
  pushToTalkGesture: "peace-sign",
  pushToTalkKey: "Ctrl+Space",
  keyMappings: [{ gesture: "open-palm-hold", key: "Return" }],
};

const formatEventLogEntry = (event: AirloomInputEvent) => {
  switch (event.type) {
    case "gesture.intent":
      return `intent ${event.gesture} ${event.phase}`;
    case "pointer.observed":
      return `pointer ${event.x.toFixed(2)},${event.y.toFixed(2)} conf=${event.confidence.toFixed(2)}`;
    case "scroll.observed":
      return `scroll ${event.amount.toFixed(2)}`;
    case "command.observed":
      return `command dx=${(event.normalizedDeltaX ?? event.deltaX).toFixed(2)} dy=${(event.normalizedDeltaY ?? event.deltaY).toFixed(2)}`;
    case "capture.state":
      return `capture ${event.recording ? "recording" : "idle"} label=${event.activeLabel} takes=${event.takeCount}`;
    case "debug.frame":
      return `preview ${event.width}x${event.height}`;
    case "status": {
      const debug = event.debug;
      if (!debug) {
        return `status gesture=${event.gesture}`;
      }

      return [
        `status gesture=${event.gesture}`,
        `pose=${debug.pose}`,
        `delay=${debug.frameDelayMs}ms`,
        `fist=${debug.closedFistFrames}`,
        `release=${debug.closedFistReleaseFrames}`,
        `latched=${debug.closedFistLatched ? "yes" : "no"}`,
      ].join(" | ");
    }
  }
};

const formatInspectorLogEntry = (entry: InspectorLogEntry) => {
  return [
    `${entry.target}`,
    `${entry.type}`,
    `detail=${entry.detail}`,
    `which=${entry.which ?? "-"}`,
    `button=${entry.button ?? "-"}`,
    `buttons=${entry.buttons ?? "-"}`,
    `t=${(entry.elapsedMs ?? 0).toFixed(1)}ms`,
  ].join(" | ");
};

export const App = () => {
  const [status, setStatus] = useState(initialStatus);
  const [settings, setSettings] = useState(defaultSettings);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [clickInspectorLog, setClickInspectorLog] = useState<
    InspectorLogEntry[]
  >([]);
  const [shapeInspectorState, setShapeInspectorState] = useState<
    "idle" | "selected" | "editing"
  >("idle");
  const [activeTab, setActiveTab] = useState<"calibration" | "settings">(
    "calibration",
  );
  const lastEventKeyRef = useRef<string | null>(null);
  const eventLogRef = useRef<HTMLPreElement | null>(null);
  const clickInspectorStartRef = useRef(performance.now());

  useEffect(() => {
    window.incantation.getStatus().then(setStatus).catch(console.error);
    window.incantation.getSettings().then(setSettings).catch(console.error);
    return window.incantation.onStatus((nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus.lastEvent === null) {
        return;
      }

      const eventKey = JSON.stringify(nextStatus.lastEvent);
      if (eventKey === lastEventKeyRef.current) {
        return;
      }

      lastEventKeyRef.current = eventKey;
      setEventLog((current) =>
        [...current, formatEventLogEntry(nextStatus.lastEvent)].slice(-80),
      );
    });
  }, []);

  const lastEventLabel = useMemo(() => {
    if (eventLog.length === 0) {
      return "No events yet";
    }

    return eventLog.join("\n");
  }, [eventLog]);

  useEffect(() => {
    if (eventLogRef.current === null) {
      return;
    }

    eventLogRef.current.scrollTop = eventLogRef.current.scrollHeight;
  });

  const sendMockEvent = async (event: AirloomInputEvent) => {
    const nextStatus = await window.incantation.sendEvent(event);
    setStatus(nextStatus);
  };

  const sendMockEvents = async (events: AirloomInputEvent[]) => {
    for (const event of events) {
      const nextStatus = await window.incantation.sendEvent(event);
      setStatus(nextStatus);
    }
  };

  const saveSettings = async (nextSettings: AirloomSettings) => {
    const saved = await window.incantation.updateSettings(nextSettings);
    setSettings(saved);
  };

  const appendInspectorEntry = (
    target: string,
    type: string,
    detail: number,
    which: number | null,
    button: number | null,
    buttons: number | null,
    elapsedMs: number,
  ) => {
    setClickInspectorLog((current) =>
      [
        ...current,
        {
          target,
          type,
          detail,
          which,
          button,
          buttons,
          elapsedMs,
        },
      ].slice(-24),
    );
  };

  const logMouseInspectorEvent = (
    target: string,
    type: string,
    event: MouseEvent<HTMLElement>,
  ) => {
    appendInspectorEntry(
      target,
      type,
      event.detail,
      event.nativeEvent.which,
      event.button,
      event.buttons,
      event.timeStamp - clickInspectorStartRef.current,
    );
  };

  const logFocusInspectorEvent = (
    target: string,
    type: string,
    event: FocusEvent<HTMLElement>,
  ) => {
    appendInspectorEntry(
      target,
      type,
      0,
      null,
      null,
      null,
      event.timeStamp - clickInspectorStartRef.current,
    );
  };

  const logInputInspectorEvent = (
    target: string,
    type: string,
    event: FormEvent<HTMLElement>,
  ) => {
    appendInspectorEntry(
      target,
      type,
      0,
      null,
      null,
      null,
      event.timeStamp - clickInspectorStartRef.current,
    );
  };

  const resetClickInspector = () => {
    clickInspectorStartRef.current = performance.now();
    setClickInspectorLog([]);
    setShapeInspectorState("idle");
  };

  const setShapeState = (nextState: "idle" | "selected" | "editing") => {
    setShapeInspectorState(nextState);
    appendInspectorEntry(
      "shape-target",
      `state:${nextState}`,
      0,
      null,
      null,
      null,
      performance.now() - clickInspectorStartRef.current,
    );
  };

  const clickInspectorSummary = useMemo(() => {
    const clickCount = clickInspectorLog.filter(
      (entry) => entry.type === "click",
    ).length;
    const doubleClickCount = clickInspectorLog.filter(
      (entry) => entry.type === "dblclick",
    ).length;
    const focusCount = clickInspectorLog.filter(
      (entry) => entry.type === "focus",
    ).length;
    return { clickCount, doubleClickCount, focusCount };
  }, [clickInspectorLog]);

  const overlayMode = useMemo(() => {
    return new URLSearchParams(window.location.search).get("overlay");
  }, []);

  const trackingBackend =
    status.runtime.debug.trackingBackend ?? settings.trackingBackend;
  const backendLabel = trackingBackend === "leap" ? "Leap" : "Webcam";
  const previewAvailable =
    status.runtime.debug.previewAvailable ?? trackingBackend === "webcam";
  const cameraUnavailable =
    trackingBackend === "webcam" &&
    (status.runtime.gesture === "camera-unavailable" ||
      status.runtime.debug.fallbackReason === "camera-unavailable");

  useEffect(() => {
    document.body.classList.toggle("overlay-mode", overlayMode !== null);
    return () => {
      document.body.classList.remove("overlay-mode");
    };
  }, [overlayMode]);

  if (overlayMode === "command-hud") {
    return (
      <CommandHud
        active={status.runtime.mapper.commandModeActive}
        submode={status.runtime.mapper.commandModeSubmode}
        deltaX={status.runtime.mapper.commandDeltaX}
        deltaY={status.runtime.mapper.commandDeltaY}
        workspaceDirection={status.runtime.mapper.workspaceDirection}
        settings={settings}
        overlayOnly
      />
    );
  }

  if (overlayMode === "camera-hud") {
    return (
      <CameraHud
        serviceRunning={status.running}
        trackingBackend={trackingBackend}
        previewAvailable={previewAvailable}
        cameraUnavailable={cameraUnavailable}
        gesture={status.runtime.gesture}
        tracking={status.runtime.tracking}
        deviceName={status.runtime.debug.deviceName}
        cameraWidth={status.runtime.debug.cameraWidth}
        cameraHeight={status.runtime.debug.cameraHeight}
        captureFps={status.runtime.debug.captureFps}
        processedFps={status.runtime.debug.processedFps}
        previewFps={status.runtime.debug.previewFps}
        frameDelayMs={status.runtime.debug.frameDelayMs}
        overlayOnly
      />
    );
  }

  return (
    <main className="shell">
      <section className="hero panel">
        <div className="hero-copy">
          <div className="eyebrow">Incantation</div>
          <h1>Gesture control for the rest of your desktop.</h1>
          <p>
            Linux-first hand tracking control with live overlays, replayable
            vision logic, and a semantic desktop runtime that can swap between
            webcam and Leap backends.
          </p>
          <div className="hero-note-grid">
            <div className="hero-note-card">
              <span>Core loop</span>
              <strong>Clutch, pinch, command, speak</strong>
            </div>
            <div className="hero-note-card">
              <span>Mode</span>
              <strong>{status.running ? "Live" : "Offline"}</strong>
            </div>
            <div className="hero-note-card">
              <span>Backend</span>
              <strong>{backendLabel}</strong>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <button
            type="button"
            onClick={() => window.incantation.startService().then(setStatus)}
          >
            Start service
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => window.incantation.stopService().then(setStatus)}
          >
            Stop service
          </button>
        </div>
      </section>

      <section className="panel live-status-strip">
        <div className="eyebrow">Live status</div>
        <div className="metric-grid compact live-status-grid">
          <div className="metric-card">
            <span>Pose</span>
            <strong>
              {status.runtime.debug.pose} (
              {status.runtime.debug.poseConfidence.toFixed(2)})
            </strong>
          </div>
          <div className="metric-card">
            <span>Gesture</span>
            <strong>{status.runtime.gesture}</strong>
          </div>
          <div className="metric-card">
            <span>Tracking</span>
            <strong>{status.runtime.tracking ? "Yes" : "No"}</strong>
          </div>
          <div className="metric-card">
            <span>Pointer</span>
            <strong>
              {status.runtime.pointerControlEnabled ? "Hold-to-move" : "Frozen"}
            </strong>
          </div>
          <div className="metric-card">
            <span>Last action</span>
            <strong>{status.runtime.recentActions.at(-1) ?? "Waiting"}</strong>
          </div>
          <div className="metric-card">
            <span>Prev action</span>
            <strong>{status.runtime.recentActions.at(-2) ?? "Waiting"}</strong>
          </div>
        </div>
      </section>

      <section className="dashboard">
        <div className="dashboard-main">
          <div className="panel status-panel">
            <div className="eyebrow">Runtime</div>
            <h2>
              {status.running
                ? "Vision service online"
                : "Vision service offline"}
            </h2>
            <div className="metric-grid compact">
              <div className="metric-card">
                <span>Backend</span>
                <strong>{backendLabel}</strong>
              </div>
              <div className="metric-card">
                <span>Adapter</span>
                <strong>{status.adapter}</strong>
              </div>
              <div className="metric-card">
                <span>Device</span>
                <strong>{status.runtime.debug.deviceName ?? "auto"}</strong>
              </div>
              <div className="metric-card">
                <span>Tracking</span>
                <strong>{status.runtime.tracking ? "Yes" : "No"}</strong>
              </div>
              <div className="metric-card">
                <span>Pointer</span>
                <strong>
                  {status.runtime.pointerControlEnabled
                    ? "Hold-to-move"
                    : "Frozen"}
                </strong>
              </div>
              <div className="metric-card">
                <span>Gesture</span>
                <strong>{status.runtime.gesture}</strong>
              </div>
            </div>
            {status.warnings.map((warning) => (
              <p className="warning-text" key={warning}>
                {warning}
              </p>
            ))}
            {status.runtime.lastError ? (
              <p className="error-text">{status.runtime.lastError}</p>
            ) : null}
          </div>

          <div className="panel control-panel">
            <div className="eyebrow">Debug</div>
            <h2>Trigger mock gestures</h2>
            <div className="mock-grid">
              <button
                type="button"
                onClick={() =>
                  sendMockEvent({
                    type: "gesture.intent",
                    gesture: "closed-fist",
                    phase: "instant",
                  })
                }
              >
                Toggle pointer
              </button>
              <button
                type="button"
                onClick={() =>
                  sendMockEvent({
                    type: "pointer.observed",
                    x: 0.62,
                    y: 0.42,
                    confidence: 0.91,
                  })
                }
              >
                Move pointer
              </button>
              <button
                type="button"
                onClick={() =>
                  sendMockEvents([
                    {
                      type: "gesture.intent",
                      gesture: "primary-pinch",
                      phase: "start",
                    },
                    {
                      type: "gesture.intent",
                      gesture: "primary-pinch",
                      phase: "end",
                    },
                  ])
                }
              >
                Left click
              </button>
              <button
                type="button"
                onClick={() =>
                  sendMockEvents([
                    {
                      type: "gesture.intent",
                      gesture: "secondary-pinch",
                      phase: "start",
                    },
                    {
                      type: "gesture.intent",
                      gesture: "secondary-pinch",
                      phase: "end",
                    },
                  ])
                }
              >
                Command right click
              </button>
              <button
                type="button"
                onClick={() =>
                  sendMockEvent({
                    type: "gesture.intent",
                    gesture: "open-palm-hold",
                    phase: "instant",
                  })
                }
              >
                Trigger mapped key
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  sendMockEvent({
                    type: "status",
                    tracking: true,
                    pinchStrength: 0.83,
                    gesture: "short-pinch",
                  })
                }
              >
                Status: pinch
              </button>
            </div>
            <div className="click-inspector-panel">
              <div className="click-inspector-header">
                <div>
                  <div className="eyebrow">Click inspector</div>
                  <p className="panel-copy">
                    Use your live pinch on these targets to see whether the
                    browser receives `click`, `dblclick`, extra `mousedown` /
                    `mouseup`, or focus/input events.
                  </p>
                </div>
                <div className="hero-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={resetClickInspector}
                  >
                    Clear log
                  </button>
                </div>
              </div>
              <div className="metric-grid compact">
                <div className="metric-card">
                  <span>Clicks</span>
                  <strong>{clickInspectorSummary.clickCount}</strong>
                </div>
                <div className="metric-card">
                  <span>Double clicks</span>
                  <strong>{clickInspectorSummary.doubleClickCount}</strong>
                </div>
                <div className="metric-card">
                  <span>Focus events</span>
                  <strong>{clickInspectorSummary.focusCount}</strong>
                </div>
                <div className="metric-card">
                  <span>Shape mode</span>
                  <strong>{shapeInspectorState}</strong>
                </div>
              </div>
              <div className="click-inspector-targets">
                <button
                  type="button"
                  className="click-inspector-target"
                  onMouseDown={(event) =>
                    logMouseInspectorEvent("button-target", "mousedown", event)
                  }
                  onMouseUp={(event) =>
                    logMouseInspectorEvent("button-target", "mouseup", event)
                  }
                  onClick={(event) =>
                    logMouseInspectorEvent("button-target", "click", event)
                  }
                  onDoubleClick={(event) =>
                    logMouseInspectorEvent("button-target", "dblclick", event)
                  }
                  onFocus={(event) =>
                    logFocusInspectorEvent("button-target", "focus", event)
                  }
                  onBlur={(event) =>
                    logFocusInspectorEvent("button-target", "blur", event)
                  }
                >
                  Selection target
                </button>
                <textarea
                  className="click-inspector-editable"
                  defaultValue={
                    "Editable target. A normal single click should focus it; a true double click should log dblclick."
                  }
                  onMouseDown={(event) =>
                    logMouseInspectorEvent(
                      "editable-target",
                      "mousedown",
                      event,
                    )
                  }
                  onMouseUp={(event) =>
                    logMouseInspectorEvent("editable-target", "mouseup", event)
                  }
                  onClick={(event) =>
                    logMouseInspectorEvent("editable-target", "click", event)
                  }
                  onDoubleClick={(event) =>
                    logMouseInspectorEvent("editable-target", "dblclick", event)
                  }
                  onFocus={(event) =>
                    logFocusInspectorEvent("editable-target", "focus", event)
                  }
                  onBlur={(event) =>
                    logFocusInspectorEvent("editable-target", "blur", event)
                  }
                  onKeyDown={() => {}}
                  onInput={(event) =>
                    logInputInspectorEvent("editable-target", "input", event)
                  }
                />
                <div className="click-inspector-shape-panel">
                  <div className="click-inspector-shape-copy">
                    Single click selects. A second click on the selected shape
                    enters edit mode. Use this to catch accidental re-entry that
                    feels like a double activation.
                  </div>
                  {shapeInspectorState === "editing" ? (
                    <textarea
                      className="click-inspector-editable click-inspector-shape-editor"
                      defaultValue={"Shape text editor"}
                      onMouseDown={(event) =>
                        logMouseInspectorEvent(
                          "shape-editor",
                          "mousedown",
                          event,
                        )
                      }
                      onMouseUp={(event) =>
                        logMouseInspectorEvent("shape-editor", "mouseup", event)
                      }
                      onClick={(event) =>
                        logMouseInspectorEvent("shape-editor", "click", event)
                      }
                      onDoubleClick={(event) =>
                        logMouseInspectorEvent(
                          "shape-editor",
                          "dblclick",
                          event,
                        )
                      }
                      onFocus={(event) =>
                        logFocusInspectorEvent("shape-editor", "focus", event)
                      }
                      onBlur={(event) => {
                        logFocusInspectorEvent("shape-editor", "blur", event);
                        setShapeState("selected");
                      }}
                      onKeyDown={() => {}}
                      onInput={(event) =>
                        logInputInspectorEvent("shape-editor", "input", event)
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      className={`click-inspector-shape ${
                        shapeInspectorState === "selected"
                          ? "click-inspector-shape-selected"
                          : ""
                      }`}
                      onMouseDown={(event) =>
                        logMouseInspectorEvent(
                          "shape-target",
                          "mousedown",
                          event,
                        )
                      }
                      onMouseUp={(event) =>
                        logMouseInspectorEvent("shape-target", "mouseup", event)
                      }
                      onClick={(event) => {
                        logMouseInspectorEvent("shape-target", "click", event);
                        setShapeState(
                          shapeInspectorState === "selected"
                            ? "editing"
                            : "selected",
                        );
                      }}
                      onDoubleClick={(event) => {
                        logMouseInspectorEvent(
                          "shape-target",
                          "dblclick",
                          event,
                        );
                        setShapeState("editing");
                      }}
                      onFocus={(event) =>
                        logFocusInspectorEvent("shape-target", "focus", event)
                      }
                      onBlur={(event) =>
                        logFocusInspectorEvent("shape-target", "blur", event)
                      }
                    >
                      {shapeInspectorState === "selected"
                        ? "Selected shape"
                        : "Shape target"}
                    </button>
                  )}
                </div>
              </div>
              <pre className="panel-copy monospace click-inspector-log">
                {clickInspectorLog.length === 0
                  ? "No DOM events captured yet"
                  : clickInspectorLog.map(formatInspectorLogEntry).join("\n")}
              </pre>
            </div>
          </div>
        </div>

        <aside className="panel event-log-panel">
          <div>
            <div className="eyebrow">Trace</div>
            <h2>Event log</h2>
            <p className="panel-copy">
              New events stay pinned to the bottom so you can watch fist
              latching and frame delay while testing live gestures.
            </p>
            <div className="hero-actions">
              <button
                type="button"
                onClick={() =>
                  (status.debugRecording.recording
                    ? window.incantation.stopDebugRecording()
                    : window.incantation.startDebugRecording()
                  ).then(setStatus)
                }
              >
                {status.debugRecording.recording
                  ? "Stop debug recording"
                  : "Record preview + debug"}
              </button>
            </div>
            <div className="metric-grid compact">
              <div className="metric-card">
                <span>Recorder</span>
                <strong>
                  {status.debugRecording.recording ? "Recording" : "Idle"}
                </strong>
              </div>
              <div className="metric-card">
                <span>Frames</span>
                <strong>{status.debugRecording.frames}</strong>
              </div>
              <div className="metric-card">
                <span>Events</span>
                <strong>{status.debugRecording.events}</strong>
              </div>
            </div>
            {status.debugRecording.sessionPath ? (
              <p className="panel-copy monospace recording-path">
                {status.debugRecording.sessionPath}
              </p>
            ) : null}
          </div>
          <pre ref={eventLogRef} className="panel-copy monospace event-log">
            {lastEventLabel}
          </pre>
        </aside>
      </section>

      <section className="tabs">
        <button
          type="button"
          className={activeTab === "calibration" ? "active-tab" : "ghost"}
          onClick={() => setActiveTab("calibration")}
        >
          Calibration
        </button>
        <button
          type="button"
          className={activeTab === "settings" ? "active-tab" : "ghost"}
          onClick={() => setActiveTab("settings")}
        >
          Settings
        </button>
      </section>

      {activeTab === "calibration" ? (
        <CalibrationPage
          serviceRunning={status.running}
          tracking={status.runtime.tracking}
          gesture={status.runtime.gesture}
          trackingBackend={trackingBackend}
          previewAvailable={previewAvailable}
          pinchStrength={status.runtime.pinchStrength}
          pointerControlEnabled={status.runtime.pointerControlEnabled}
          pushToTalkGesture={settings.pushToTalkGesture}
          pushToTalkKey={settings.pushToTalkKey}
          debug={status.runtime.debug}
          capture={status.capture}
          onCaptureLabelChange={(label) =>
            window.incantation.setCaptureLabel(label).then(setStatus)
          }
          onCaptureStart={() =>
            window.incantation.startCapture().then(setStatus)
          }
          onCaptureStop={() => window.incantation.stopCapture().then(setStatus)}
          onDiscardLastCapture={() =>
            window.incantation.discardLastCapture().then(setStatus)
          }
          onExportCaptures={() =>
            window.incantation.exportCaptures().then(setStatus)
          }
          primaryPinchActive={status.runtime.mapper.primaryPinchActive}
          primaryPinchHeldMs={status.runtime.mapper.primaryPinchHeldMs}
          primaryPinchOutcome={status.runtime.mapper.primaryPinchOutcome}
          commandModeActive={status.runtime.mapper.commandModeActive}
          commandModeSubmode={status.runtime.mapper.commandModeSubmode}
          commandDeltaX={status.runtime.mapper.commandDeltaX}
          commandDeltaY={status.runtime.mapper.commandDeltaY}
          workspaceDirection={status.runtime.mapper.workspaceDirection}
        />
      ) : (
        <SettingsPage
          settings={settings}
          serviceRunning={status.running}
          onSave={saveSettings}
        />
      )}
    </main>
  );
};
