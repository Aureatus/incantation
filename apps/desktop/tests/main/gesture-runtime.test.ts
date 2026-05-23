import { describe, expect, test } from "bun:test";
import { createGestureRuntime } from "../../src/main/gesture-runtime";
import type { InputAdapter } from "../../src/main/input/types";

const createTestAdapter = () => {
  const calls: string[] = [];
  const adapter: InputAdapter = {
    platform: "test",
    isAvailable: () => true,
    getPointerPosition: async () => ({ x: 50, y: 60 }),
    movePointer: async () => {
      calls.push("move");
    },
    scroll: async (amount) => {
      calls.push(`scroll:${amount.toFixed(2)}`);
    },
    pointerDown: async () => {
      calls.push("down");
    },
    pointerUp: async () => {
      calls.push("up");
    },
    click: async (button) => {
      calls.push(`click:${button}`);
    },
    keyDown: async (key) => {
      calls.push(`keydown:${key}`);
    },
    keyUp: async (key) => {
      calls.push(`keyup:${key}`);
    },
    tapKey: async (key) => {
      calls.push(`key:${key}`);
    },
  };

  return { adapter, calls };
};

const createTestSettings = (key = "Return") => {
  return {
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
    keyMappings: [{ gesture: "open-palm-hold", key }],
  };
};

describe("createGestureRuntime", () => {
  test("routes click and key events to adapter", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "closed-fist",
      phase: "instant",
    });

    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "primary-pinch",
      phase: "start",
    });
    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "primary-pinch",
      phase: "end",
    });
    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "open-palm-hold",
      phase: "instant",
    });

    expect(calls).toEqual(["click:left", "key:Return"]);
    expect(runtime.getState().recentActions).toEqual([
      "left click",
      "Key Return",
    ]);
  });

  test("holds left button during a drag pinch and releases on pinch end", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0,
      gesture: "closed-fist",
      debug: {
        confidence: 0.74,
        brightness: 0.21,
        frameDelayMs: 18,
        pose: "closed-fist",
        poseConfidence: 0.88,
        poseScores: {
          neutral: 0.12,
          "open-palm": 0.18,
          "closed-fist": 0.88,
          "primary-pinch": 0.14,
          "secondary-pinch": 0.06,
        },
        classifierMode: "rules",
        modelVersion: null,
        closedFist: true,
        closedFistFrames: 4,
        closedFistReleaseFrames: 0,
        closedFistLatched: true,
        openPalmHold: false,
        secondaryPinchStrength: 0.14,
      },
    });

    await runtime.handleEvent({
      type: "pointer.observed",
      x: 0.4,
      y: 0.5,
      confidence: 0.92,
    });
    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "primary-pinch",
      phase: "start",
    });
    await runtime.handleEvent({
      type: "pointer.observed",
      x: 0.42,
      y: 0.54,
      confidence: 0.92,
    });
    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "primary-pinch",
      phase: "end",
    });

    expect(calls).toEqual(["move", "down", "move", "up"]);
    expect(runtime.getState().recentActions).toEqual([
      "Move 0.42, 0.54",
      "left up",
    ]);
  });

  test("updates status state from status events", async () => {
    const { adapter } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0.82,
      gesture: "short-pinch",
      debug: {
        confidence: 0.74,
        brightness: 0.21,
        frameDelayMs: 18,
        pose: "closed-fist",
        poseConfidence: 0.88,
        poseScores: {
          neutral: 0.12,
          "open-palm": 0.18,
          "closed-fist": 0.88,
          "primary-pinch": 0.14,
          "secondary-pinch": 0.06,
        },
        classifierMode: "rules",
        modelVersion: null,
        closedFist: true,
        closedFistFrames: 4,
        closedFistReleaseFrames: 0,
        closedFistLatched: true,
        openPalmHold: false,
        secondaryPinchStrength: 0.14,
      },
    });

    expect(runtime.getState()).toEqual({
      tracking: true,
      gesture: "short-pinch",
      pinchStrength: 0.82,
      pointerControlEnabled: true,
      inputSuppressed: false,
      recentActions: [],
      debug: {
        confidence: 0.74,
        brightness: 0.21,
        frameDelayMs: 18,
        pose: "closed-fist",
        poseConfidence: 0.88,
        poseScores: {
          neutral: 0.12,
          "open-palm": 0.18,
          "closed-fist": 0.88,
          "primary-pinch": 0.14,
          "secondary-pinch": 0.06,
        },
        classifierMode: "rules",
        modelVersion: null,
        closedFist: true,
        closedFistFrames: 4,
        closedFistReleaseFrames: 0,
        closedFistLatched: true,
        openPalmHold: false,
        secondaryPinchStrength: 0.14,
      },
      mapper: {
        pointerControlEnabled: true,
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
    });
  });

  test("ignores secondary pinch lifecycle while command mode is parked", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "start",
    });

    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "end",
    });

    expect(calls).toEqual([]);
    expect(runtime.getState().mapper.commandModeActive).toBe(false);
  });

  test("suppresses pointer and gesture actions during capture mode", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    runtime.setInputSuppressed(true);

    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "closed-fist",
      phase: "instant",
    });
    await runtime.handleEvent({
      type: "pointer.observed",
      x: 0.4,
      y: 0.5,
      confidence: 0.92,
    });

    expect(calls).toEqual([]);
    expect(runtime.getState().inputSuppressed).toBe(true);
    expect(runtime.getState().recentActions).toEqual([]);

    runtime.setInputSuppressed(false);
    await runtime.handleEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0,
      gesture: "closed-fist",
      debug: {
        confidence: 0.74,
        brightness: 0.21,
        frameDelayMs: 18,
        pose: "closed-fist",
        poseConfidence: 0.88,
        poseScores: {
          neutral: 0.12,
          "open-palm": 0.18,
          "closed-fist": 0.88,
          "primary-pinch": 0.14,
          "secondary-pinch": 0.06,
        },
        classifierMode: "rules",
        modelVersion: null,
        closedFist: true,
        closedFistFrames: 4,
        closedFistReleaseFrames: 0,
        closedFistLatched: true,
        openPalmHold: false,
        secondaryPinchStrength: 0.14,
      },
    });
    await runtime.handleEvent({
      type: "pointer.observed",
      x: 0.4,
      y: 0.5,
      confidence: 0.92,
    });
    await runtime.handleEvent({
      type: "pointer.observed",
      x: 0.42,
      y: 0.54,
      confidence: 0.92,
    });

    expect(calls).toEqual(["move", "move"]);
    expect(runtime.getState().recentActions).toEqual([
      "Move 0.40, 0.50",
      "Move 0.42, 0.54",
    ]);
  });

  test("maps gesture triggers to configured keys", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings("space"),
    );

    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "open-palm-hold",
      phase: "instant",
    });

    expect(calls).toEqual(["key:space"]);
  });

  test("passes modifier key chords through to the adapter", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings("Ctrl+Space"),
    );

    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "open-palm-hold",
      phase: "instant",
    });

    expect(calls).toEqual(["key:Ctrl+Space"]);
  });

  test("holds push-to-talk key while peace sign is active", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "peace-sign",
      phase: "start",
    });
    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "peace-sign",
      phase: "end",
    });

    expect(calls).toEqual(["keydown:Ctrl+Space", "keyup:Ctrl+Space"]);
    expect(runtime.getState().recentActions).toEqual([
      "Key down Ctrl+Space",
      "Key up Ctrl+Space",
    ]);
  });

  test("releases held push-to-talk when input is suppressed", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "peace-sign",
      phase: "start",
    });
    await runtime.setInputSuppressed(true);

    expect(calls).toEqual(["keydown:Ctrl+Space", "keyup:Ctrl+Space"]);
    expect(runtime.getState().recentActions).toEqual([
      "Key down Ctrl+Space",
      "Key up Ctrl+Space",
    ]);
  });

  test("maps the configured right-click gesture to a right click", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "thumb-middle-pinch",
      phase: "instant",
    });

    expect(calls).toEqual(["click:right"]);
  });

  test("ignores command observations after secondary pinch while parked", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "gesture.intent",
      gesture: "secondary-pinch",
      phase: "start",
    });
    await runtime.handleEvent({
      type: "command.observed",
      deltaX: 0.01,
      deltaY: 0.01,
    });

    expect(calls).toEqual([]);
  });

  test("routes scroll observed events to the adapter", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "scroll.observed",
      amount: -2.5,
    });

    expect(calls).toEqual(["scroll:-2.50"]);
    expect(runtime.getState().recentActions).toEqual(["Scroll -2.50"]);
  });

  test("ignores pointer movement until closed-fist status is active", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "pointer.observed",
      x: 0.4,
      y: 0.5,
      confidence: 0.92,
    });
    await runtime.handleEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0,
      gesture: "closed-fist",
      debug: {
        confidence: 0.74,
        brightness: 0.21,
        frameDelayMs: 18,
        pose: "closed-fist",
        poseConfidence: 0.88,
        poseScores: {
          neutral: 0.12,
          "open-palm": 0.18,
          "closed-fist": 0.88,
          "primary-pinch": 0.14,
          "secondary-pinch": 0.06,
        },
        classifierMode: "rules",
        modelVersion: null,
        closedFist: true,
        closedFistFrames: 4,
        closedFistReleaseFrames: 0,
        closedFistLatched: true,
        openPalmHold: false,
        secondaryPinchStrength: 0.14,
      },
    });
    await runtime.handleEvent({
      type: "pointer.observed",
      x: 0.4,
      y: 0.5,
      confidence: 0.92,
    });
    await runtime.handleEvent({
      type: "pointer.observed",
      x: 0.42,
      y: 0.54,
      confidence: 0.92,
    });

    expect(calls).toEqual(["move", "move"]);
    expect(runtime.getState().pointerControlEnabled).toBe(true);
  });

  test("freezes pointer again when status leaves closed fist", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0,
      gesture: "closed-fist",
      debug: {
        confidence: 0.74,
        brightness: 0.21,
        frameDelayMs: 18,
        pose: "closed-fist",
        poseConfidence: 0.88,
        poseScores: {
          neutral: 0.12,
          "open-palm": 0.18,
          "closed-fist": 0.88,
          "primary-pinch": 0.14,
          "secondary-pinch": 0.06,
        },
        classifierMode: "rules",
        modelVersion: null,
        closedFist: true,
        closedFistFrames: 4,
        closedFistReleaseFrames: 0,
        closedFistLatched: true,
        openPalmHold: false,
        secondaryPinchStrength: 0.14,
      },
    });
    await runtime.handleEvent({
      type: "pointer.observed",
      x: 0.4,
      y: 0.5,
      confidence: 0.92,
    });
    await runtime.handleEvent({
      type: "pointer.observed",
      x: 0.42,
      y: 0.54,
      confidence: 0.92,
    });
    await runtime.handleEvent({
      type: "status",
      tracking: true,
      pinchStrength: 0,
      gesture: "open-palm",
      debug: {
        confidence: 0.74,
        brightness: 0.21,
        frameDelayMs: 18,
        pose: "open-palm",
        poseConfidence: 0.88,
        poseScores: {
          neutral: 0.12,
          "open-palm": 0.88,
          "closed-fist": 0.08,
          "primary-pinch": 0.04,
          "secondary-pinch": 0.03,
        },
        classifierMode: "rules",
        modelVersion: null,
        closedFist: false,
        closedFistFrames: 0,
        closedFistReleaseFrames: 1,
        closedFistLatched: false,
        openPalmHold: true,
        secondaryPinchStrength: 0.14,
      },
    });
    await runtime.handleEvent({
      type: "pointer.observed",
      x: 0.45,
      y: 0.55,
      confidence: 0.92,
    });

    expect(calls).toEqual(["move", "move"]);
    expect(runtime.getState().pointerControlEnabled).toBe(false);
  });

  test("ignores backend debug frame events for input actions", async () => {
    const { adapter, calls } = createTestAdapter();
    const runtime = createGestureRuntime(
      adapter,
      (x, y) => ({ x, y }),
      () => createTestSettings(),
    );

    await runtime.handleEvent({
      type: "debug.frame",
      mimeType: "image/jpeg",
      data: "abc123",
      width: 160,
      height: 120,
    });

    expect(calls).toEqual([]);
    expect(runtime.getState().lastError).toBeNull();
  });
});
