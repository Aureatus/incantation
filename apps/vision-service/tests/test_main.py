from io import BytesIO
from typing import cast

import numpy as np

from app.leap_device import LeapFrameSample
from app.main import emit_preview_frame, encode_debug_frame, run_live
from app.protocol import (
    FrameState,
    GestureEvent,
    StatusDebug,
    empty_pose_scores,
    pose_scores_for_pose,
)


class _FakeCamera:
    def __init__(self, frame: object) -> None:
        self._frame = frame

    def __enter__(self) -> "_FakeCamera":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        return None

    def read(self) -> object:
        return self._frame


class _FakeTracker:
    def process(self, frame: object) -> FrameState:
        if hasattr(frame, "shape") or getattr(frame, "preview_frame", None) is not None:
            import time

            time.sleep(0.02)

        return {
            "tracking": True,
            "pointer": {"x": 0.5, "y": 0.4},
            "pose": "neutral",
            "pose_confidence": 0.74,
            "pose_scores": pose_scores_for_pose("neutral", 0.74),
            "classifier_mode": "learned",
            "pinch_strength": 0.0,
            "secondary_pinch_strength": 0.0,
            "open_palm_hold": False,
            "confidence": 0.9,
            "closed_fist": False,
            "brightness": 0.4,
        }


class _FakeMachine:
    def update(self, frame: FrameState) -> list[GestureEvent]:
        debug: StatusDebug = {
            "confidence": frame["confidence"],
            "brightness": frame.get("brightness", 0.0),
            "frameDelayMs": frame.get("delay_ms", 0),
            "pose": frame.get("pose", "unknown"),
            "poseConfidence": frame.get("pose_confidence", 0.0),
            "poseScores": frame.get("pose_scores", empty_pose_scores()),
            "classifierMode": frame.get("classifier_mode", "rules"),
            "modelVersion": frame.get("model_version"),
            "closedFist": frame.get("closed_fist", False),
            "closedFistFrames": 0,
            "closedFistReleaseFrames": 0,
            "closedFistLatched": False,
            "openPalmHold": frame["open_palm_hold"],
            "secondaryPinchStrength": frame["secondary_pinch_strength"],
        }
        if "pointer_hand" in frame:
            debug["pointerHand"] = frame["pointer_hand"]
        if "action_hand" in frame:
            debug["actionHand"] = frame["action_hand"]
        if "fallback_reason" in frame:
            debug["fallbackReason"] = frame["fallback_reason"]

        return [
            {
                "type": "status",
                "tracking": frame["tracking"],
                "pinchStrength": frame["pinch_strength"],
                "gesture": "idle",
                "debug": debug,
            }
        ]


def test_run_live_emits_camera_unavailable_status_and_retries() -> None:
    events: list[object] = []
    sleeps: list[float] = []
    attempts = 0

    def camera_factory() -> _FakeCamera:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("Unable to open webcam")
        return _FakeCamera(frame={"id": attempts})

    run_live(
        max_frames=2,
        emit_event=events.append,
        sleep_for=sleeps.append,
        camera_factory=camera_factory,
        tracker_factory=_FakeTracker,
        machine_factory=_FakeMachine,
    )

    first_event = events[0]
    assert isinstance(first_event, dict)
    first_event = cast(dict[str, object], first_event)
    assert first_event["type"] == "capture.state"
    assert events[1] == {
        "type": "status",
        "tracking": False,
        "pinchStrength": 0.0,
        "gesture": "camera-unavailable",
        "debug": {
            "trackingBackend": "webcam",
            "previewAvailable": True,
            "confidence": 0.0,
            "brightness": 0.0,
            "frameDelayMs": 0,
            "pose": "unknown",
            "poseConfidence": 0.0,
            "poseScores": empty_pose_scores(),
            "classifierMode": "learned",
            "modelVersion": None,
            "closedFist": False,
            "closedFistFrames": 0,
            "closedFistReleaseFrames": 0,
            "closedFistLatched": False,
            "openPalmHold": False,
            "secondaryPinchStrength": 0.0,
            "fallbackReason": "camera-unavailable",
        },
    }
    status_event = events[2]
    assert isinstance(status_event, dict)
    status_event = cast(dict[str, object], status_event)
    status_debug = cast(dict[str, object], status_event["debug"])
    assert status_event["type"] == "status"
    assert status_event["tracking"] is True
    assert status_event["pinchStrength"] == 0.0
    assert status_event["gesture"] == "idle"
    assert status_debug == {
        "confidence": 0.9,
        "brightness": 0.4,
        "frameDelayMs": status_debug["frameDelayMs"],
        "pose": "neutral",
        "poseConfidence": 0.74,
        "poseScores": pose_scores_for_pose("neutral", 0.74),
        "classifierMode": "learned",
        "modelVersion": None,
        "closedFist": False,
        "closedFistFrames": 0,
        "closedFistReleaseFrames": 0,
        "closedFistLatched": False,
        "openPalmHold": False,
        "secondaryPinchStrength": 0.0,
    }
    assert cast(int, status_debug["frameDelayMs"]) >= 0
    assert sleeps == [1.0]


def test_run_live_emits_leap_unavailable_status() -> None:
    events: list[object] = []
    sleeps: list[float] = []

    def failing_camera_factory() -> _FakeCamera:
        raise RuntimeError("Leap runtime unavailable")

    run_live(
        max_frames=2,
        tracking_backend="leap",
        emit_event=events.append,
        sleep_for=sleeps.append,
        camera_factory=failing_camera_factory,
        tracker_factory=_FakeTracker,
        machine_factory=_FakeMachine,
    )

    assert events[1] == {
        "type": "status",
        "tracking": False,
        "pinchStrength": 0.0,
        "gesture": "device-unavailable",
        "debug": {
            "trackingBackend": "leap",
            "previewAvailable": False,
            "confidence": 0.0,
            "brightness": 0.5,
            "frameDelayMs": 0,
            "pose": "unknown",
            "poseConfidence": 0.0,
            "poseScores": empty_pose_scores(),
            "classifierMode": "learned",
            "modelVersion": None,
            "closedFist": False,
            "closedFistFrames": 0,
            "closedFistReleaseFrames": 0,
            "closedFistLatched": False,
            "openPalmHold": False,
            "secondaryPinchStrength": 0.0,
            "fallbackReason": "device-unavailable",
        },
    }
    assert sleeps == [5.0]


def test_encode_debug_frame_emits_jpeg_payload() -> None:
    frame = np.zeros((120, 160, 3), dtype=np.uint8)
    encoded = encode_debug_frame(
        frame,
        {
            "tracking": True,
            "pointer": {"x": 0.5, "y": 0.4},
            "raw_pointer": {"x": 0.45, "y": 0.4},
            "action_pointer": {"x": 0.68, "y": 0.38},
            "pose": "primary-pinch",
            "pose_confidence": 0.88,
            "pose_scores": pose_scores_for_pose("primary-pinch", 0.88),
            "pinch_strength": 0.4,
            "secondary_pinch_strength": 0.1,
            "action_hand_separate": True,
            "open_palm_hold": False,
            "closed_fist": False,
            "confidence": 0.9,
            "brightness": 0.4,
            "hand_landmarks": [{"x": 0.4, "y": 0.4}, {"x": 0.5, "y": 0.5}],
            "action_hand_landmarks": [{"x": 0.62, "y": 0.36}, {"x": 0.72, "y": 0.48}],
        },
    )

    assert encoded is not None
    assert encoded[:2] == b"\xff\xd8"
    assert len(encoded) > 100


def test_emit_preview_frame_writes_length_prefixed_jpeg() -> None:
    frame = np.zeros((120, 160, 3), dtype=np.uint8)
    output = BytesIO()

    written = emit_preview_frame(frame, None, output)

    assert written is True
    raw = output.getvalue()
    payload_size = int.from_bytes(raw[:4], byteorder="big")
    payload = raw[4:]
    assert payload_size == len(payload)
    assert payload[:2] == b"\xff\xd8"


def test_emit_preview_frame_writes_jpeg_for_leap_preview_frame() -> None:
    frame = LeapFrameSample(
        seq=1,
        captured_at=1.0,
        hands=[],
        preview_frame=np.zeros((80, 160), dtype=np.uint8),
    )
    output = BytesIO()

    written = emit_preview_frame(frame, None, output)

    assert written is True
    raw = output.getvalue()
    payload_size = int.from_bytes(raw[:4], byteorder="big")
    payload = raw[4:]
    assert payload_size == len(payload)
    assert payload[:2] == b"\xff\xd8"


def test_run_live_emits_preview_frames_when_enabled() -> None:
    events: list[object] = []
    preview_frames: list[object] = []
    frame = np.zeros((120, 160, 3), dtype=np.uint8)

    run_live(
        max_frames=2,
        emit_event=events.append,
        sleep_for=lambda _seconds: None,
        time_source=lambda: 1.0,
        camera_factory=lambda: _FakeCamera(frame=frame),
        tracker_factory=_FakeTracker,
        machine_factory=_FakeMachine,
        preview_enabled=True,
        preview_emitter=lambda preview, _frame_state: preview_frames.append(preview) is None,
    )

    status_event = events[1]

    assert isinstance(status_event, dict)
    status_event = cast(dict[str, object], status_event)
    assert status_event["type"] == "status"
    assert len(preview_frames) >= 1


def test_run_live_emits_leap_preview_frames_when_enabled() -> None:
    events: list[object] = []
    preview_frames: list[object] = []
    frame = LeapFrameSample(
        seq=1,
        captured_at=1.0,
        hands=[],
        preview_frame=np.zeros((80, 160), dtype=np.uint8),
    )

    run_live(
        max_frames=2,
        tracking_backend="leap",
        emit_event=events.append,
        sleep_for=lambda _seconds: None,
        time_source=lambda: 1.0,
        camera_factory=lambda: _FakeCamera(frame=frame),
        tracker_factory=_FakeTracker,
        machine_factory=_FakeMachine,
        preview_enabled=True,
        preview_emitter=lambda preview, _frame_state: preview_frames.append(preview) is None,
    )

    status_event = events[1]

    assert isinstance(status_event, dict)
    status_event = cast(dict[str, object], status_event)
    assert status_event["type"] == "status"
    assert len(preview_frames) >= 1
