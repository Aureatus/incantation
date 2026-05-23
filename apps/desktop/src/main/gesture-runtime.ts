import type {
  AirloomActionEvent,
  AirloomInputEvent,
  AirloomStatusDebug,
} from "@incantation/shared/gesture-events";
import type { AirloomSettings } from "@incantation/shared/settings-schema";
import {
  type ActionMapperDebugState,
  createActionMapper,
} from "./action-mapper";
import type { InputAdapter } from "./input/types";

export type RuntimeState = {
  tracking: boolean;
  gesture: string;
  pinchStrength: number;
  pointerControlEnabled: boolean;
  inputSuppressed: boolean;
  recentActions: string[];
  debug: AirloomStatusDebug;
  mapper: ActionMapperDebugState;
  lastError: string | null;
};

type NormalizePosition = (
  x: number,
  y: number,
) => {
  x: number;
  y: number;
};

type GetSettings = () => AirloomSettings;

export const createGestureRuntime = (
  adapter: InputAdapter,
  normalizePosition: NormalizePosition,
  getSettings: GetSettings,
) => {
  const actionMapper = createActionMapper(getSettings, normalizePosition);
  const state: RuntimeState = {
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
    mapper: actionMapper.getDebugState(),
    lastError: null,
  };

  const syncMapperState = () => {
    state.mapper = actionMapper.getDebugState();
    state.pointerControlEnabled = state.mapper.pointerControlEnabled;
  };

  const describeAction = (event: AirloomActionEvent) => {
    switch (event.type) {
      case "pointer.move":
        return `Move ${event.x.toFixed(2)}, ${event.y.toFixed(2)}`;
      case "pointer.down":
        return `${event.button} down`;
      case "pointer.up":
        return `${event.button} up`;
      case "click":
        return `${event.button} click`;
      case "key.tap":
        return `Key ${event.key}`;
      case "key.down":
        return `Key down ${event.key}`;
      case "key.up":
        return `Key up ${event.key}`;
      case "scroll":
        return `Scroll ${event.amount.toFixed(2)}`;
    }
  };

  const rememberAction = (event: AirloomActionEvent) => {
    state.recentActions = [...state.recentActions, describeAction(event)].slice(
      -2,
    );
  };

  const executeAction = async (event: AirloomActionEvent) => {
    rememberAction(event);
    switch (event.type) {
      case "pointer.move": {
        await adapter.movePointer({ x: event.x, y: event.y });
        return;
      }

      case "pointer.down": {
        await adapter.pointerDown(event.button);
        return;
      }

      case "scroll": {
        await adapter.scroll(event.amount);
        return;
      }

      case "pointer.up": {
        await adapter.pointerUp(event.button);
        return;
      }

      case "click": {
        await adapter.click(event.button);
        return;
      }

      case "key.down": {
        await adapter.keyDown(event.key);
        return;
      }

      case "key.up": {
        await adapter.keyUp(event.key);
        return;
      }

      case "key.tap": {
        await adapter.tapKey(event.key);
        return;
      }
    }
  };

  const handleEvent = async (event: AirloomInputEvent) => {
    try {
      switch (event.type) {
        case "debug.frame": {
          syncMapperState();
          return state;
        }

        case "pointer.observed": {
          if (!state.inputSuppressed) {
            for (const action of actionMapper.mapEvent(event)) {
              await executeAction(action);
            }
          }
          state.tracking = event.confidence > 0;
          syncMapperState();
          return state;
        }

        case "scroll.observed": {
          if (!state.inputSuppressed) {
            for (const action of actionMapper.mapEvent(event)) {
              await executeAction(action);
            }
          }
          syncMapperState();
          return state;
        }

        case "command.observed": {
          if (!state.inputSuppressed) {
            for (const action of actionMapper.mapEvent(event)) {
              await executeAction(action);
            }
          }
          syncMapperState();
          return state;
        }

        case "gesture.intent": {
          if (!state.inputSuppressed) {
            for (const action of actionMapper.mapEvent(event)) {
              await executeAction(action);
            }
          }

          syncMapperState();
          return state;
        }

        case "status": {
          if (!state.inputSuppressed) {
            for (const action of actionMapper.mapEvent(event)) {
              await executeAction(action);
            }
          } else {
            actionMapper.mapEvent(event);
          }
          state.tracking = event.tracking;
          state.gesture = event.gesture;
          state.pinchStrength = event.pinchStrength;
          state.debug = event.debug ?? state.debug;
          syncMapperState();
          return state;
        }

        case "capture.state": {
          syncMapperState();
          return state;
        }
      }
    } catch (error) {
      state.lastError =
        error instanceof Error ? error.message : "Unknown runtime error";
      return state;
    }
  };

  const getState = () => {
    return {
      ...state,
      recentActions: [...state.recentActions],
    };
  };

  const setInputSuppressed = async (suppressed: boolean) => {
    if (suppressed && !state.inputSuppressed) {
      for (const action of actionMapper.releaseHeldActions()) {
        await executeAction(action);
      }
      syncMapperState();
    }
    state.inputSuppressed = suppressed;
    return getState();
  };

  const releaseHeldActions = async () => {
    for (const action of actionMapper.releaseHeldActions()) {
      await executeAction(action);
    }
    syncMapperState();
    return getState();
  };

  return {
    handleEvent,
    getState,
    releaseHeldActions,
    setInputSuppressed,
  };
};
