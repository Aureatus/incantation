import { z } from "zod";
import { trackingBackendSchema } from "./settings-schema";

const landmarkSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const pointerObservedEventSchema = z.object({
  type: z.literal("pointer.observed"),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

export const scrollObservedEventSchema = z.object({
  type: z.literal("scroll.observed"),
  amount: z.number(),
});

export const commandObservedEventSchema = z.object({
  type: z.literal("command.observed"),
  deltaX: z.number(),
  deltaY: z.number(),
  normalizedDeltaX: z.number().optional(),
  normalizedDeltaY: z.number().optional(),
});

export const gestureIntentEventSchema = z.object({
  type: z.literal("gesture.intent"),
  gesture: z.string().min(1),
  phase: z.enum(["start", "end", "cancel", "instant"]),
});

export const debugFrameEventSchema = z.object({
  type: z.literal("debug.frame"),
  mimeType: z.literal("image/jpeg"),
  data: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const captureCountsSchema = z.object({
  neutral: z.number().int().nonnegative(),
  "open-palm": z.number().int().nonnegative(),
  "blade-hand": z.number().int().nonnegative(),
  "closed-fist": z.number().int().nonnegative(),
  "primary-pinch": z.number().int().nonnegative(),
  "secondary-pinch": z.number().int().nonnegative(),
  "peace-sign": z.number().int().nonnegative(),
});

export const captureStateEventSchema = z.object({
  type: z.literal("capture.state"),
  sessionId: z.string().min(1),
  activeLabel: z.string().min(1),
  recording: z.boolean(),
  takeCount: z.number().int().nonnegative(),
  counts: captureCountsSchema,
  lastTakeId: z.string().nullable(),
  exportPath: z.string().nullable(),
  message: z.string().nullable(),
});

export const statusDebugSchema = z.object({
  trackingBackend: trackingBackendSchema.optional(),
  deviceName: z.string().min(1).optional(),
  previewAvailable: z.boolean().optional(),
  confidence: z.number().min(0).max(1),
  brightness: z.number().min(0).max(1),
  frameDelayMs: z.number().int().nonnegative(),
  cameraWidth: z.number().int().positive().optional(),
  cameraHeight: z.number().int().positive().optional(),
  captureFps: z.number().nonnegative().optional(),
  processedFps: z.number().nonnegative().optional(),
  previewFps: z.number().nonnegative().optional(),
  pose: z.string().min(1),
  poseConfidence: z.number().min(0).max(1),
  poseScores: z.object({
    neutral: z.number().min(0).max(1),
    "open-palm": z.number().min(0).max(1),
    "blade-hand": z.number().min(0).max(1),
    "closed-fist": z.number().min(0).max(1),
    "primary-pinch": z.number().min(0).max(1),
    "secondary-pinch": z.number().min(0).max(1),
    "peace-sign": z.number().min(0).max(1),
  }),
  classifierMode: z.enum(["rules", "shadow", "learned"]),
  modelVersion: z.string().nullable(),
  learnedPose: z.string().min(1).optional(),
  learnedPoseConfidence: z.number().min(0).max(1).optional(),
  shadowDisagreement: z.boolean().optional(),
  actionPose: z.string().min(1).optional(),
  actionPoseConfidence: z.number().min(0).max(1).optional(),
  actionPoseScores: z
    .object({
      neutral: z.number().min(0).max(1),
      "open-palm": z.number().min(0).max(1),
      "blade-hand": z.number().min(0).max(1),
      "closed-fist": z.number().min(0).max(1),
      "primary-pinch": z.number().min(0).max(1),
      "secondary-pinch": z.number().min(0).max(1),
      "peace-sign": z.number().min(0).max(1),
    })
    .optional(),
  closedFist: z.boolean(),
  closedFistFrames: z.number().int().nonnegative(),
  closedFistReleaseFrames: z.number().int().nonnegative(),
  closedFistLatched: z.boolean(),
  openPalmHold: z.boolean(),
  secondaryPinchStrength: z.number().min(0).max(1),
  secondaryPinchActive: z.boolean().optional(),
  bladeHandActive: z.boolean().optional(),
  bladeHandScore: z.number().min(0).max(1).optional(),
  bladeScrollDeltaY: z.number().optional(),
  bladeScrollAccumulated: z.number().optional(),
  pointerHand: z.string().min(1).optional(),
  actionHand: z.string().min(1).optional(),
  fallbackReason: z.string().min(1).optional(),
  leapPointerMode: z.enum(["free", "clutch"]).optional(),
  leapControlPointer: landmarkSchema.optional(),
  leapPreviewPointer: landmarkSchema.optional(),
  leapClutchAnchor: landmarkSchema.optional(),
  leapPreviewClutchAnchor: landmarkSchema.optional(),
  leapClutchDeltaX: z.number().optional(),
  leapClutchDeltaY: z.number().optional(),
  leapPointerMinX: z.number().optional(),
  leapPointerMaxX: z.number().optional(),
  leapPointerMinZ: z.number().optional(),
  leapPointerMaxZ: z.number().optional(),
});

export const statusEventSchema = z.object({
  type: z.literal("status"),
  tracking: z.boolean(),
  pinchStrength: z.number().min(0).max(1),
  gesture: z.string(),
  debug: statusDebugSchema.optional(),
});

export const inputEventSchema = z.discriminatedUnion("type", [
  pointerObservedEventSchema,
  scrollObservedEventSchema,
  commandObservedEventSchema,
  gestureIntentEventSchema,
  debugFrameEventSchema,
  captureStateEventSchema,
  statusEventSchema,
]);

export const pointerMoveActionSchema = z.object({
  type: z.literal("pointer.move"),
  x: z.number(),
  y: z.number(),
});

export const pointerDownActionSchema = z.object({
  type: z.literal("pointer.down"),
  button: z.enum(["left", "middle", "right"]),
});

export const pointerUpActionSchema = z.object({
  type: z.literal("pointer.up"),
  button: z.enum(["left", "middle", "right"]),
});

export const clickActionSchema = z.object({
  type: z.literal("click"),
  button: z.enum(["left", "middle", "right"]),
});

export const keyTapActionSchema = z.object({
  type: z.literal("key.tap"),
  key: z.string().min(1),
});

export const keyDownActionSchema = z.object({
  type: z.literal("key.down"),
  key: z.string().min(1),
});

export const keyUpActionSchema = z.object({
  type: z.literal("key.up"),
  key: z.string().min(1),
});

export const scrollActionSchema = z.object({
  type: z.literal("scroll"),
  amount: z.number(),
});

export const actionEventSchema = z.discriminatedUnion("type", [
  pointerMoveActionSchema,
  pointerDownActionSchema,
  pointerUpActionSchema,
  clickActionSchema,
  keyTapActionSchema,
  keyDownActionSchema,
  keyUpActionSchema,
  scrollActionSchema,
]);

export type AirloomInputEvent = z.infer<typeof inputEventSchema>;
export type AirloomActionEvent = z.infer<typeof actionEventSchema>;
export type AirloomStatusEvent = z.infer<typeof statusEventSchema>;
export type AirloomStatusDebug = z.infer<typeof statusDebugSchema>;
export type AirloomCaptureStateEvent = z.infer<typeof captureStateEventSchema>;

export const parseInputEvent = (value: unknown): AirloomInputEvent => {
  return inputEventSchema.parse(value);
};

export const parseActionEvent = (value: unknown): AirloomActionEvent => {
  return actionEventSchema.parse(value);
};
