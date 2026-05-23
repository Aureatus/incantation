import { describe, expect, test } from "bun:test";
import { createActionMapper } from "../../src/main/action-mapper";

const createSettings = () => ({
  trackingBackend: "webcam" as const,
  leapOrientation: "normal" as const,
  smoothing: 0.72,
  pointerRegionMargin: 0.12,
  clickPinchThreshold: 0.78,
  dragStartDeadzone: 0.015,
  bladeHandScrollEnabled: true,
  bladeHandScrollDeadzone: 0.01,
  bladeHandScrollGain: 72,
  bladeHandScrollActivationFrames: 2,
  bladeHandScrollReleaseFrames: 2,
  rightClickGesture: "thumb-middle-pinch",
  workspacePreviousKey: "Ctrl+Alt+Left",
  workspaceNextKey: "Ctrl+Alt+Right",
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
});

describe("createActionMapper", () => {
  test("maps a short primary pinch to left click actions", () => {
    let time = 100;
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
      () => time,
    );

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "primary-pinch",
        phase: "start",
      }),
    ).toEqual([]);

    time += 120;

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "primary-pinch",
        phase: "end",
      }),
    ).toEqual([{ type: "click", button: "left" }]);

    expect(mapper.getDebugState()).toEqual({
      pointerControlEnabled: false,
      primaryPinchActive: false,
      primaryPinchHeldMs: 0,
      primaryPinchOutcome: "idle",
      commandModeActive: false,
      commandModeSubmode: "idle",
      commandDeltaX: 0,
      commandDeltaY: 0,
      workspaceDirection: "idle",
    });
  });

  test("starts a drag only after clutch movement while pinched", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    mapper.mapEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0,
      gesture: "closed-fist",
      debug: {
        confidence: 0.9,
        brightness: 0.4,
        frameDelayMs: 10,
        pose: "closed-fist",
        poseConfidence: 0.9,
        poseScores: {
          neutral: 0.05,
          "open-palm": 0.04,
          "closed-fist": 0.9,
          "primary-pinch": 0.01,
          "secondary-pinch": 0.01,
        },
        classifierMode: "learned",
        modelVersion: null,
        closedFist: true,
        closedFistFrames: 2,
        closedFistReleaseFrames: 0,
        closedFistLatched: true,
        openPalmHold: false,
        secondaryPinchStrength: 0.1,
      },
    });

    expect(
      mapper.mapEvent({
        type: "pointer.observed",
        x: 0.6,
        y: 0.4,
        confidence: 0.91,
      }),
    ).toEqual([{ type: "pointer.move", x: 60, y: 40 }]);

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "primary-pinch",
        phase: "start",
      }),
    ).toEqual([]);

    expect(
      mapper.mapEvent({
        type: "pointer.observed",
        x: 0.6,
        y: 0.4,
        confidence: 0.91,
      }),
    ).toEqual([{ type: "pointer.move", x: 60, y: 40 }]);

    expect(
      mapper.mapEvent({
        type: "pointer.observed",
        x: 0.608,
        y: 0.408,
        confidence: 0.91,
      }),
    ).toEqual([{ type: "pointer.move", x: 61, y: 41 }]);

    expect(
      mapper.mapEvent({
        type: "pointer.observed",
        x: 0.64,
        y: 0.44,
        confidence: 0.91,
      }),
    ).toEqual([
      { type: "pointer.down", button: "left" },
      { type: "pointer.move", x: 64, y: 44 },
    ]);

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "primary-pinch",
        phase: "end",
      }),
    ).toEqual([{ type: "pointer.up", button: "left" }]);
  });

  test("keeps click preview until clutch movement starts a drag", () => {
    let time = 100;
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
      () => time,
    );

    mapper.mapEvent({
      type: "gesture.intent",
      gesture: "primary-pinch",
      phase: "start",
    });

    time += 120;
    expect(mapper.getDebugState()).toEqual({
      pointerControlEnabled: false,
      primaryPinchActive: true,
      primaryPinchHeldMs: 120,
      primaryPinchOutcome: "click",
      commandModeActive: false,
      commandModeSubmode: "idle",
      commandDeltaX: 0,
      commandDeltaY: 0,
      workspaceDirection: "idle",
    });

    mapper.mapEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0,
      gesture: "closed-fist",
      debug: {
        confidence: 0.9,
        brightness: 0.4,
        frameDelayMs: 10,
        pose: "closed-fist",
        poseConfidence: 0.9,
        poseScores: {
          neutral: 0.05,
          "open-palm": 0.04,
          "closed-fist": 0.9,
          "primary-pinch": 0.01,
          "secondary-pinch": 0.01,
        },
        classifierMode: "learned",
        modelVersion: null,
        closedFist: true,
        closedFistFrames: 2,
        closedFistReleaseFrames: 0,
        closedFistLatched: true,
        openPalmHold: false,
        secondaryPinchStrength: 0.1,
      },
    });
    mapper.mapEvent({
      type: "pointer.observed",
      x: 0.62,
      y: 0.42,
      confidence: 0.91,
    });

    time += 200;
    expect(mapper.getDebugState()).toEqual({
      pointerControlEnabled: true,
      primaryPinchActive: true,
      primaryPinchHeldMs: 320,
      primaryPinchOutcome: "click",
      commandModeActive: false,
      commandModeSubmode: "idle",
      commandDeltaX: 0,
      commandDeltaY: 0,
      workspaceDirection: "idle",
    });

    mapper.mapEvent({
      type: "pointer.observed",
      x: 0.66,
      y: 0.46,
      confidence: 0.91,
    });

    expect(mapper.getDebugState()).toEqual({
      pointerControlEnabled: true,
      primaryPinchActive: true,
      primaryPinchHeldMs: 320,
      primaryPinchOutcome: "drag",
      commandModeActive: false,
      commandModeSubmode: "idle",
      commandDeltaX: 0,
      commandDeltaY: 0,
      workspaceDirection: "idle",
    });
  });

  test("ignores secondary pinch lifecycle when command mode is parked", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "secondary-pinch",
        phase: "start",
      }),
    ).toEqual([]);

    expect(mapper.getDebugState().commandModeActive).toBe(false);

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "secondary-pinch",
        phase: "end",
      }),
    ).toEqual([]);
  });

  test("ignores command observations while command mode is parked", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    mapper.mapEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "start",
    });

    expect(
      mapper.mapEvent({
        type: "command.observed",
        deltaX: 0.01,
        deltaY: -0.01,
      }),
    ).toEqual([]);
  });

  test("ignores vertical command motion so release no longer right clicks", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    mapper.mapEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "start",
    });

    expect(
      mapper.mapEvent({
        type: "command.observed",
        deltaX: 0,
        deltaY: 0.08,
      }),
    ).toEqual([]);

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "secondary-pinch",
        phase: "end",
      }),
    ).toEqual([]);

    expect(mapper.getDebugState().commandModeSubmode).toBe("idle");
  });

  test("does not scroll for large vertical command motion", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    mapper.mapEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "start",
    });

    expect(
      mapper.mapEvent({
        type: "command.observed",
        deltaX: 0,
        deltaY: 0.18,
      }),
    ).toEqual([]);

    expect(mapper.getDebugState().commandModeSubmode).toBe("idle");
  });

  test("ignores normalized vertical command deltas for scrolling", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    mapper.mapEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "start",
    });

    expect(
      mapper.mapEvent({
        type: "command.observed",
        deltaX: 0,
        deltaY: 0.02,
        normalizedDeltaY: 0.16,
      }),
    ).toEqual([]);

    expect(mapper.getDebugState().commandModeSubmode).toBe("idle");
  });

  test("does not map horizontal command motion to workspace taps while parked", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    mapper.mapEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "start",
    });

    expect(
      mapper.mapEvent({
        type: "command.observed",
        deltaX: 0.09,
        deltaY: 0.01,
      }),
    ).toEqual([]);

    expect(
      mapper.mapEvent({
        type: "command.observed",
        deltaX: 0.22,
        deltaY: 0.01,
      }),
    ).toEqual([]);

    mapper.mapEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "end",
    });

    mapper.mapEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "start",
    });

    expect(
      mapper.mapEvent({
        type: "command.observed",
        deltaX: -0.09,
        deltaY: 0.01,
      }),
    ).toEqual([]);
  });

  test("cancels secondary pinch without right click on cancel phase", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    mapper.mapEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "start",
    });
    mapper.mapEvent({
      type: "command.observed",
      deltaX: 0.14,
      deltaY: 0,
    });

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "secondary-pinch",
        phase: "cancel",
      }),
    ).toEqual([]);

    expect(mapper.getDebugState().commandModeActive).toBe(false);
  });

  test("drops command mode cleanly on tracking loss", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    mapper.mapEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "start",
    });
    mapper.mapEvent({
      type: "command.observed",
      deltaX: 0.11,
      deltaY: 0,
    });

    expect(
      mapper.mapEvent({
        type: "status",
        tracking: false,
        pinchStrength: 0,
        gesture: "searching",
        debug: {
          confidence: 0,
          brightness: 0,
          frameDelayMs: 0,
          pose: "unknown",
          poseConfidence: 0,
          poseScores: {
            neutral: 0,
            "open-palm": 0,
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
          secondaryPinchActive: false,
        },
      }),
    ).toEqual([]);

    expect(mapper.getDebugState().commandModeActive).toBe(false);
  });

  test("emits pointer down before move when drag starts during clutch motion", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    mapper.mapEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0,
      gesture: "closed-fist",
      debug: {
        confidence: 0.9,
        brightness: 0.4,
        frameDelayMs: 10,
        pose: "closed-fist",
        poseConfidence: 0.9,
        poseScores: {
          neutral: 0.05,
          "open-palm": 0.04,
          "closed-fist": 0.9,
          "primary-pinch": 0.01,
          "secondary-pinch": 0.01,
        },
        classifierMode: "learned",
        modelVersion: null,
        closedFist: true,
        closedFistFrames: 2,
        closedFistReleaseFrames: 0,
        closedFistLatched: true,
        openPalmHold: false,
        secondaryPinchStrength: 0.1,
      },
    });
    mapper.mapEvent({
      type: "gesture.intent",
      gesture: "primary-pinch",
      phase: "start",
    });

    mapper.mapEvent({
      type: "pointer.observed",
      x: 0.6,
      y: 0.4,
      confidence: 0.91,
    });

    expect(
      mapper.mapEvent({
        type: "pointer.observed",
        x: 0.62,
        y: 0.42,
        confidence: 0.91,
      }),
    ).toEqual([
      { type: "pointer.down", button: "left" },
      { type: "pointer.move", x: 62, y: 42 },
    ]);
  });

  test("maps symbolic gestures to configurable actions", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "thumb-middle-pinch",
        phase: "instant",
      }),
    ).toEqual([{ type: "click", button: "right" }]);

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "open-palm-hold",
        phase: "instant",
      }),
    ).toEqual([{ type: "key.tap", key: "Return" }]);

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "peace-sign",
        phase: "start",
      }),
    ).toEqual([{ type: "key.down", key: "Ctrl+Space" }]);

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "peace-sign",
        phase: "end",
      }),
    ).toEqual([{ type: "key.up", key: "Ctrl+Space" }]);
  });

  test("releases push-to-talk if status stops reporting it", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    expect(
      mapper.mapEvent({
        type: "gesture.intent",
        gesture: "peace-sign",
        phase: "start",
      }),
    ).toEqual([{ type: "key.down", key: "Ctrl+Space" }]);

    expect(
      mapper.mapEvent({
        type: "status",
        tracking: false,
        pinchStrength: 0,
        gesture: "searching",
        debug: {
          confidence: 0,
          brightness: 0.2,
          frameDelayMs: 20,
          pose: "unknown",
          poseConfidence: 0,
          poseScores: {
            neutral: 0,
            "open-palm": 0,
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
        },
      }),
    ).toEqual([{ type: "key.up", key: "Ctrl+Space" }]);
  });

  test("maps scroll observations to scroll actions", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    expect(
      mapper.mapEvent({
        type: "scroll.observed",
        amount: 3.25,
      }),
    ).toEqual([{ type: "scroll", amount: 3.25 }]);
  });

  test("only moves pointer while closed fist is active in status", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    expect(
      mapper.mapEvent({
        type: "pointer.observed",
        x: 0.62,
        y: 0.42,
        confidence: 0.91,
      }),
    ).toEqual([]);

    mapper.mapEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0,
      gesture: "closed-fist",
      debug: {
        confidence: 0.9,
        brightness: 0.4,
        frameDelayMs: 10,
        pose: "closed-fist",
        poseConfidence: 0.9,
        poseScores: {
          neutral: 0.05,
          "open-palm": 0.04,
          "closed-fist": 0.9,
          "primary-pinch": 0.01,
          "secondary-pinch": 0.01,
        },
        classifierMode: "learned",
        modelVersion: null,
        closedFist: true,
        closedFistFrames: 2,
        closedFistReleaseFrames: 0,
        closedFistLatched: true,
        openPalmHold: false,
        secondaryPinchStrength: 0.1,
      },
    });
    expect(
      mapper.mapEvent({
        type: "pointer.observed",
        x: 0.62,
        y: 0.42,
        confidence: 0.91,
      }),
    ).toEqual([{ type: "pointer.move", x: 62, y: 42 }]);
  });

  test("freezes movement again when status leaves closed fist", () => {
    const mapper = createActionMapper(
      () => createSettings(),
      (x, y) => ({ x: Math.round(x * 100), y: Math.round(y * 100) }),
    );

    mapper.mapEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0,
      gesture: "closed-fist",
      debug: {
        confidence: 0.9,
        brightness: 0.4,
        frameDelayMs: 10,
        pose: "closed-fist",
        poseConfidence: 0.9,
        poseScores: {
          neutral: 0.05,
          "open-palm": 0.04,
          "closed-fist": 0.9,
          "primary-pinch": 0.01,
          "secondary-pinch": 0.01,
        },
        classifierMode: "learned",
        modelVersion: null,
        closedFist: true,
        closedFistFrames: 2,
        closedFistReleaseFrames: 0,
        closedFistLatched: true,
        openPalmHold: false,
        secondaryPinchStrength: 0.1,
      },
    });
    expect(
      mapper.mapEvent({
        type: "pointer.observed",
        x: 0.62,
        y: 0.42,
        confidence: 0.91,
      }),
    ).toEqual([{ type: "pointer.move", x: 62, y: 42 }]);

    mapper.mapEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0,
      gesture: "open-palm",
      debug: {
        confidence: 0.9,
        brightness: 0.4,
        frameDelayMs: 10,
        pose: "open-palm",
        poseConfidence: 0.9,
        poseScores: {
          neutral: 0.05,
          "open-palm": 0.9,
          "closed-fist": 0.03,
          "primary-pinch": 0.01,
          "secondary-pinch": 0.01,
        },
        classifierMode: "learned",
        modelVersion: null,
        closedFist: false,
        closedFistFrames: 0,
        closedFistReleaseFrames: 1,
        closedFistLatched: false,
        openPalmHold: true,
        secondaryPinchStrength: 0.1,
      },
    });

    expect(
      mapper.mapEvent({
        type: "pointer.observed",
        x: 0.62,
        y: 0.42,
        confidence: 0.91,
      }),
    ).toEqual([]);

    expect(mapper.getDebugState()).toEqual({
      pointerControlEnabled: false,
      primaryPinchActive: false,
      primaryPinchHeldMs: 0,
      primaryPinchOutcome: "idle",
      commandModeActive: false,
      commandModeSubmode: "idle",
      commandDeltaX: 0,
      commandDeltaY: 0,
      workspaceDirection: "idle",
    });
  });
});
