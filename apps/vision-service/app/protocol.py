from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


class Landmark(TypedDict):
    x: float
    y: float


PoseName = Literal[
    "unknown",
    "neutral",
    "open-palm",
    "blade-hand",
    "closed-fist",
    "primary-pinch",
    "secondary-pinch",
    "peace-sign",
]

PoseClassifierMode = Literal["rules", "shadow", "learned"]
TrackingBackend = Literal["webcam", "leap"]


PoseScores = TypedDict(
    "PoseScores",
    {
        "neutral": float,
        "open-palm": float,
        "blade-hand": float,
        "closed-fist": float,
        "primary-pinch": float,
        "secondary-pinch": float,
        "peace-sign": float,
    },
)


def empty_pose_scores() -> PoseScores:
    return {
        "neutral": 0.0,
        "open-palm": 0.0,
        "blade-hand": 0.0,
        "closed-fist": 0.0,
        "primary-pinch": 0.0,
        "secondary-pinch": 0.0,
        "peace-sign": 0.0,
    }


def pose_scores_for_pose(pose: PoseName, confidence: float) -> PoseScores:
    scores = empty_pose_scores()
    if pose != "unknown":
        scores[pose] = confidence
    return scores


CaptureCounts = TypedDict(
    "CaptureCounts",
    {
        "neutral": int,
        "open-palm": int,
        "blade-hand": int,
        "closed-fist": int,
        "primary-pinch": int,
        "secondary-pinch": int,
        "peace-sign": int,
    },
)


def empty_capture_counts() -> CaptureCounts:
    return {
        "neutral": 0,
        "open-palm": 0,
        "blade-hand": 0,
        "closed-fist": 0,
        "primary-pinch": 0,
        "secondary-pinch": 0,
        "peace-sign": 0,
    }


class PoseObservation(TypedDict):
    pose: PoseName
    confidence: float
    scores: PoseScores


class PointerObservedEvent(TypedDict):
    type: Literal["pointer.observed"]
    x: float
    y: float
    confidence: float


class ScrollObservedEvent(TypedDict):
    type: Literal["scroll.observed"]
    amount: float


class CommandObservedEvent(TypedDict):
    type: Literal["command.observed"]
    deltaX: float
    deltaY: float
    normalizedDeltaX: NotRequired[float]
    normalizedDeltaY: NotRequired[float]


class GestureIntentEvent(TypedDict):
    type: Literal["gesture.intent"]
    gesture: str
    phase: Literal["start", "end", "cancel", "instant"]


class DebugFrameEvent(TypedDict):
    type: Literal["debug.frame"]
    mimeType: Literal["image/jpeg"]
    data: str
    width: int
    height: int


class CaptureStateEvent(TypedDict):
    type: Literal["capture.state"]
    sessionId: str
    activeLabel: PoseName
    recording: bool
    takeCount: int
    counts: CaptureCounts
    lastTakeId: str | None
    exportPath: str | None
    message: str | None


class StatusEvent(TypedDict):
    type: Literal["status"]
    tracking: bool
    pinchStrength: float
    gesture: str
    debug: NotRequired[StatusDebug]


class StatusDebug(TypedDict):
    trackingBackend: NotRequired[TrackingBackend]
    deviceName: NotRequired[str]
    previewAvailable: NotRequired[bool]
    confidence: float
    brightness: float
    frameDelayMs: int
    cameraWidth: NotRequired[int]
    cameraHeight: NotRequired[int]
    captureFps: NotRequired[float]
    processedFps: NotRequired[float]
    previewFps: NotRequired[float]
    pose: PoseName
    poseConfidence: float
    poseScores: PoseScores
    classifierMode: PoseClassifierMode
    modelVersion: str | None
    learnedPose: NotRequired[PoseName]
    learnedPoseConfidence: NotRequired[float]
    shadowDisagreement: NotRequired[bool]
    actionPose: NotRequired[PoseName]
    actionPoseConfidence: NotRequired[float]
    actionPoseScores: NotRequired[PoseScores]
    closedFist: bool
    closedFistFrames: int
    closedFistReleaseFrames: int
    closedFistLatched: bool
    openPalmHold: bool
    secondaryPinchStrength: float
    secondaryPinchActive: NotRequired[bool]
    bladeHandActive: NotRequired[bool]
    bladeHandScore: NotRequired[float]
    bladeScrollDeltaY: NotRequired[float]
    bladeScrollAccumulated: NotRequired[float]
    pointerHand: NotRequired[str]
    actionHand: NotRequired[str]
    fallbackReason: NotRequired[str]
    leapPointerMode: NotRequired[Literal["free", "clutch"]]
    leapControlPointer: NotRequired[Landmark]
    leapPreviewPointer: NotRequired[Landmark]
    leapClutchAnchor: NotRequired[Landmark]
    leapPreviewClutchAnchor: NotRequired[Landmark]
    leapClutchDeltaX: NotRequired[float]
    leapClutchDeltaY: NotRequired[float]
    leapPointerMinX: NotRequired[float]
    leapPointerMaxX: NotRequired[float]
    leapPointerMinZ: NotRequired[float]
    leapPointerMaxZ: NotRequired[float]


GestureEvent = (
    PointerObservedEvent
    | ScrollObservedEvent
    | CommandObservedEvent
    | GestureIntentEvent
    | DebugFrameEvent
    | StatusEvent
    | CaptureStateEvent
)


class FrameState(TypedDict):
    tracking: bool
    tracking_backend: NotRequired[TrackingBackend]
    device_name: NotRequired[str]
    preview_available: NotRequired[bool]
    pointer: NotRequired[Landmark]
    raw_pointer: NotRequired[Landmark]
    preview_pointer: NotRequired[Landmark]
    preview_raw_pointer: NotRequired[Landmark]
    preview_clutch_anchor: NotRequired[Landmark]
    clutch_anchor: NotRequired[Landmark]
    clutch_delta_x: NotRequired[float]
    clutch_delta_y: NotRequired[float]
    pointer_mode: NotRequired[Literal["free", "clutch"]]
    pointer_range_min_x: NotRequired[float]
    pointer_range_max_x: NotRequired[float]
    pointer_range_min_z: NotRequired[float]
    pointer_range_max_z: NotRequired[float]
    camera_width: NotRequired[int]
    camera_height: NotRequired[int]
    capture_fps: NotRequired[float]
    processed_fps: NotRequired[float]
    preview_fps: NotRequired[float]
    pose: PoseName
    pose_confidence: float
    pose_scores: NotRequired[PoseScores]
    classifier_mode: NotRequired[PoseClassifierMode]
    model_version: NotRequired[str | None]
    learned_pose: NotRequired[PoseName]
    learned_pose_confidence: NotRequired[float]
    shadow_disagreement: NotRequired[bool]
    pinch_strength: float
    secondary_pinch_strength: float
    action_pose: NotRequired[PoseName]
    action_pose_confidence: NotRequired[float]
    action_pose_scores: NotRequired[PoseScores]
    action_pinch_strength: NotRequired[float]
    action_secondary_pinch_strength: NotRequired[float]
    action_open_palm_hold: NotRequired[bool]
    action_hand_separate: NotRequired[bool]
    action_pointer: NotRequired[Landmark]
    preview_action_pointer: NotRequired[Landmark]
    pointer_hand: NotRequired[str]
    action_hand: NotRequired[str]
    open_palm_hold: bool
    closed_fist: NotRequired[bool]
    confidence: float
    brightness: NotRequired[float]
    hand_landmarks: NotRequired[list[Landmark]]
    action_hand_landmarks: NotRequired[list[Landmark]]
    feature_values: NotRequired[dict[str, float]]
    delay_ms: NotRequired[int]
    fallback_reason: NotRequired[str]
