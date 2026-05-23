import { z } from "zod";

export const trackingBackendSchema = z.enum(["webcam", "leap"]);
export const leapOrientationSchema = z.enum(["normal", "inverted"]);

export const keybindMappingSchema = z.object({
  gesture: z.string().min(1),
  key: z.string().min(1),
});

export const commandHudPositionSchema = z.enum([
  "top-right",
  "top-left",
  "bottom-right",
  "bottom-left",
]);

export const settingsSchema = z.object({
  trackingBackend: trackingBackendSchema.default("webcam"),
  leapOrientation: leapOrientationSchema.default("normal"),
  smoothing: z.number().min(0).max(1).default(0.5),
  pointerRegionMargin: z.number().min(0).max(0.35).default(0.08),
  clickPinchThreshold: z.number().min(0).max(1).default(0.78),
  dragStartDeadzone: z.number().min(0).max(0.1).default(0.015),
  bladeHandScrollEnabled: z.boolean().default(true),
  bladeHandScrollDeadzone: z.number().min(0).max(0.1).default(0.01),
  bladeHandScrollGain: z.number().min(1).max(200).default(72),
  bladeHandScrollActivationFrames: z.number().int().min(1).max(12).default(2),
  bladeHandScrollReleaseFrames: z.number().int().min(1).max(12).default(2),
  rightClickGesture: z.string().default("thumb-middle-pinch"),
  workspacePreviousKey: z.string().default(""),
  workspaceNextKey: z.string().default(""),
  commandHudPosition: commandHudPositionSchema.default("top-right"),
  cameraHudPosition: commandHudPositionSchema.default("top-left"),
  commandModeRightClickDeadzone: z.number().min(0).max(0.2).default(0.04),
  commandModeMiddleClickTapMs: z.number().int().min(0).max(1000).default(180),
  commandModeScrollDeadzone: z.number().min(0).max(0.3).default(0.05),
  commandModeScrollFastThreshold: z.number().min(0.05).max(0.4).default(0.14),
  commandModeScrollGain: z.number().min(1).max(200).default(32),
  commandModeWorkspaceThreshold: z.number().min(0.01).max(0.5).default(0.08),
  commandModeWorkspaceStep: z.number().min(0.01).max(0.5).default(0.12),
  pushToTalkGesture: z.string().default("peace-sign"),
  pushToTalkKey: z.string().default("Ctrl+Space"),
  keyMappings: z
    .array(keybindMappingSchema)
    .default([{ gesture: "open-palm-hold", key: "Return" }]),
});

export type AirloomSettings = z.infer<typeof settingsSchema>;
export type TrackingBackend = z.infer<typeof trackingBackendSchema>;
export type LeapOrientation = z.infer<typeof leapOrientationSchema>;

export const parseAirloomSettings = (value: unknown): AirloomSettings => {
  return settingsSchema.parse(value);
};
