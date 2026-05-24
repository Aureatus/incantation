from __future__ import annotations

import argparse
import inspect
import json
import os
import sys
import time
from collections.abc import Callable
from pathlib import Path
from threading import Thread
from typing import Any, BinaryIO, cast

from app.camera import Camera
from app.capture_controller import CaptureController
from app.gestures import GestureMachine
from app.hand_tracking import HandTracker
from app.leap_device import LeapCamera
from app.leap_tracking import LeapTracker
from app.live_pipeline import run_live_pipeline
from app.protocol import FrameState, Landmark, PoseName, TrackingBackend, empty_pose_scores
from app.replay import iter_replay, load_fixture

DEBUG_PREVIEW_MAX_WIDTH = 320
DEBUG_PREVIEW_JPEG_QUALITY = 70
DEBUG_PREVIEW_ENABLED = (
    os.environ.get("INCANTATION_DEBUG_PREVIEW") or os.environ.get("AIRLOOM_DEBUG_PREVIEW", "0")
) == "1"
DEBUG_PREVIEW_FD = 3
LEAP_RETRY_DELAY_S = float(
    os.environ.get("INCANTATION_LEAP_RETRY_DELAY_S")
    or os.environ.get("AIRLOOM_LEAP_RETRY_DELAY_S", "5")
)


def env_value(name: str, legacy_name: str, default: str | Path) -> str:
    resolved = os.environ.get(name) or os.environ.get(legacy_name)
    if resolved is None:
        return str(default)
    return resolved


DEFAULT_CAPTURE_DIR = Path(
    env_value(
        "INCANTATION_CAPTURE_DIR", "AIRLOOM_CAPTURE_DIR", Path.cwd() / ".incantation-captures"
    )
)
DEFAULT_CAPTURE_EXPORT_DIR = Path(
    env_value(
        "INCANTATION_CAPTURE_EXPORT_DIR",
        "AIRLOOM_CAPTURE_EXPORT_DIR",
        Path.cwd() / "data" / "pose-captures",
    )
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Incantation vision service")
    parser.add_argument("--stdio", action="store_true", help="emit events as JSON lines to stdout")
    parser.add_argument("--fixture", type=Path, help="replay a landmark/frame-state fixture")
    parser.add_argument(
        "--backend",
        choices=["webcam", "leap"],
        default=cast(
            TrackingBackend,
            env_value("INCANTATION_TRACKING_BACKEND", "AIRLOOM_TRACKING_BACKEND", "webcam"),
        ),
        help="tracking backend to use for live input",
    )
    parser.add_argument(
        "--max-frames", type=int, default=0, help="cap live processing frames for testing"
    )
    return parser.parse_args()


def emit(event: object) -> None:
    print(json.dumps(event), flush=True)


def emit_camera_unavailable(
    message: str,
    emit_event: Callable[[object], None],
    tracking_backend: TrackingBackend,
) -> None:
    print(f"vision service: {message}", file=sys.stderr, flush=True)
    if tracking_backend == "webcam":
        fallback_reason = "camera-unavailable"
    else:
        fallback_reason = "device-unavailable"
    emit_event(
        {
            "type": "status",
            "tracking": False,
            "pinchStrength": 0.0,
            "gesture": fallback_reason,
            "debug": {
                "trackingBackend": tracking_backend,
                "previewAvailable": tracking_backend == "webcam",
                "confidence": 0.0,
                "brightness": 0.5 if tracking_backend == "leap" else 0.0,
                "frameDelayMs": 0,
                "pose": "unknown",
                "poseConfidence": 0.0,
                "poseScores": empty_pose_scores(),
                "classifierMode": env_value(
                    "INCANTATION_POSE_CLASSIFIER_MODE",
                    "AIRLOOM_POSE_CLASSIFIER_MODE",
                    "learned",
                ),
                "modelVersion": None,
                "closedFist": False,
                "closedFistFrames": 0,
                "closedFistReleaseFrames": 0,
                "closedFistLatched": False,
                "openPalmHold": False,
                "secondaryPinchStrength": 0.0,
                "fallbackReason": fallback_reason,
            },
        }
    )


def _draw_marker(frame: Any, point: Landmark, color: tuple[int, int, int], radius: int) -> None:
    import cv2

    height, width = frame.shape[:2]
    center = (int(point["x"] * width), int(point["y"] * height))
    cv2.circle(frame, center, radius, color, thickness=-1)


def _draw_ring(frame: Any, point: Landmark, color: tuple[int, int, int], radius: int) -> None:
    import cv2

    height, width = frame.shape[:2]
    center = (int(point["x"] * width), int(point["y"] * height))
    cv2.circle(frame, center, radius, color, thickness=2)


def _draw_vector(
    frame: Any,
    start: Landmark,
    end: Landmark,
    color: tuple[int, int, int],
) -> None:
    import cv2

    height, width = frame.shape[:2]
    start_px = (int(start["x"] * width), int(start["y"] * height))
    end_px = (int(end["x"] * width), int(end["y"] * height))
    cv2.arrowedLine(frame, start_px, end_px, color, 2, cv2.LINE_AA, tipLength=0.18)


def annotate_debug_frame(frame: Any, frame_state: FrameState | None) -> Any:
    import cv2

    if len(frame.shape) == 2:
        annotated = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
    else:
        annotated = frame.copy()
    height, width = annotated.shape[:2]

    if frame_state is not None:
        for point in frame_state.get("hand_landmarks", []):
            _draw_marker(annotated, point, (94, 215, 190), 3)

        action_hand_landmarks = frame_state.get("action_hand_landmarks", [])
        if frame_state.get("action_hand_separate"):
            for point in action_hand_landmarks:
                _draw_marker(annotated, point, (255, 209, 102), 3)

        raw_pointer = frame_state.get("preview_raw_pointer") or frame_state.get("raw_pointer")
        if raw_pointer is not None:
            _draw_marker(annotated, raw_pointer, (255, 209, 102), 6)

        action_pointer = frame_state.get("preview_action_pointer") or frame_state.get(
            "action_pointer"
        )
        if frame_state.get("action_hand_separate") and action_pointer is not None:
            _draw_marker(annotated, action_pointer, (255, 230, 163), 5)

        pointer = frame_state.get("preview_pointer") or frame_state.get("pointer")
        if pointer is not None:
            _draw_marker(annotated, pointer, (255, 127, 107), 5)

        clutch_anchor = frame_state.get("preview_clutch_anchor")
        if clutch_anchor is not None:
            _draw_ring(annotated, clutch_anchor, (111, 170, 255), 9)
            if pointer is not None:
                _draw_vector(annotated, clutch_anchor, pointer, (111, 170, 255))

        label = (
            f"pose={frame_state.get('pose', 'unknown')} "
            f"pose_conf={frame_state.get('pose_confidence', 0.0):.2f} "
            f"pinch={frame_state['pinch_strength']:.2f} "
            f"secondary={frame_state['secondary_pinch_strength']:.2f}"
        )
        cv2.putText(
            annotated,
            label,
            (14, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (244, 248, 248),
            2,
            cv2.LINE_AA,
        )

        pose_scores = frame_state.get("pose_scores") or empty_pose_scores()
        classifier_label = (
            f"scores p={pose_scores['primary-pinch']:.2f} "
            f"v={pose_scores['peace-sign']:.2f} "
            f"f={pose_scores['closed-fist']:.2f} "
            f"o={pose_scores['open-palm']:.2f} "
            f"n={pose_scores['neutral']:.2f}"
        )
        cv2.putText(
            annotated,
            classifier_label,
            (14, 52),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (214, 226, 236),
            1,
            cv2.LINE_AA,
        )

        learned_pose = frame_state.get("learned_pose")
        if learned_pose is not None:
            learned_label = (
                f"mode={frame_state.get('classifier_mode', 'rules')} "
                f"learned={learned_pose} {frame_state.get('learned_pose_confidence', 0.0):.2f}"
            )
            cv2.putText(
                annotated,
                learned_label,
                (14, 74),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.48,
                (214, 226, 236),
                1,
                cv2.LINE_AA,
            )

        if frame_state.get("tracking_backend") == "leap":
            pointer_mode = frame_state.get("pointer_mode", "free")
            clutch_delta_x = frame_state.get("clutch_delta_x", 0.0)
            clutch_delta_y = frame_state.get("clutch_delta_y", 0.0)
            pointer_range_min_x = frame_state.get("pointer_range_min_x", 0.0)
            pointer_range_max_x = frame_state.get("pointer_range_max_x", 0.0)
            pointer_range_min_z = frame_state.get("pointer_range_min_z", 0.0)
            pointer_range_max_z = frame_state.get("pointer_range_max_z", 0.0)
            leap_label = (
                f"leap mode={pointer_mode} "
                f"dx={clutch_delta_x:+.2f} dy={clutch_delta_y:+.2f} "
                f"x={pointer_range_min_x:.0f}..{pointer_range_max_x:.0f} "
                f"z={pointer_range_min_z:.0f}..{pointer_range_max_z:.0f}"
            )
            cv2.putText(
                annotated,
                leap_label,
                (14, 96),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.48,
                (182, 205, 255),
                1,
                cv2.LINE_AA,
            )

    cv2.rectangle(annotated, (0, 0), (width - 1, height - 1), (94, 215, 190), 1)
    return annotated


def encode_debug_frame(frame: Any, frame_state: FrameState | None = None) -> bytes | None:
    import cv2

    preview_frame = frame
    if not hasattr(preview_frame, "shape"):
        preview_frame = getattr(frame, "preview_frame", None)

    if preview_frame is None or not hasattr(preview_frame, "shape"):
        return None

    preview_source = annotate_debug_frame(preview_frame, frame_state)

    height, width = preview_source.shape[:2]
    if width <= 0 or height <= 0:
        return None

    scale = min(1.0, DEBUG_PREVIEW_MAX_WIDTH / width)
    preview = preview_source
    preview_width = width
    preview_height = height
    if scale < 1.0:
        preview_width = max(1, int(width * scale))
        preview_height = max(1, int(height * scale))
        preview = cv2.resize(preview_source, (preview_width, preview_height))

    ok, encoded = cv2.imencode(
        ".jpg",
        preview,
        [int(cv2.IMWRITE_JPEG_QUALITY), DEBUG_PREVIEW_JPEG_QUALITY],
    )
    if not ok:
        return None

    return encoded.tobytes()


def open_preview_pipe() -> BinaryIO | None:
    try:
        preview_fd = os.dup(DEBUG_PREVIEW_FD)
    except OSError:
        return None

    return os.fdopen(preview_fd, "wb", buffering=0)


def emit_preview_frame(
    frame: Any, frame_state: FrameState | None, preview_pipe: BinaryIO | None
) -> bool:
    if preview_pipe is None:
        return False

    encoded = encode_debug_frame(frame, frame_state)
    if encoded is None:
        return False

    preview_pipe.write(len(encoded).to_bytes(4, byteorder="big"))
    preview_pipe.write(encoded)
    preview_pipe.flush()
    return True


def run_fixture(path: Path) -> None:
    frames = load_fixture(path)
    for frame, events in iter_replay(frames):
        for event in events:
            emit(event)

        delay_ms = frame.get("delay_ms", 0)
        if delay_ms > 0:
            time.sleep(delay_ms / 1000)


def run_live(
    max_frames: int,
    tracking_backend: TrackingBackend = "webcam",
    emit_event: Callable[[object], None] = emit,
    sleep_for: Callable[[float], None] = time.sleep,
    time_source: Callable[[], float] = time.monotonic,
    camera_factory: Callable[[], Any] | None = None,
    tracker_factory: Callable[..., Any] | None = None,
    machine_factory: Callable[[], Any] = GestureMachine,
    preview_enabled: bool = DEBUG_PREVIEW_ENABLED,
    preview_emitter: Callable[[Any, FrameState | None], bool] | None = None,
) -> None:
    processed = 0
    capture_controller = CaptureController(
        root_dir=DEFAULT_CAPTURE_DIR,
        export_dir=DEFAULT_CAPTURE_EXPORT_DIR,
        emit_event=emit_event,
        mirror_x=env_value("INCANTATION_MIRROR_X", "AIRLOOM_MIRROR_X", "1") != "0",
    )
    live_camera_factory = camera_factory or (LeapCamera if tracking_backend == "leap" else Camera)
    live_tracker_factory = tracker_factory or (
        LeapTracker if tracking_backend == "leap" else HandTracker
    )
    preview_is_enabled = preview_enabled
    preview_pipe = open_preview_pipe() if preview_is_enabled and preview_emitter is None else None
    emit_preview = preview_emitter or (
        lambda frame, frame_state: emit_preview_frame(frame, frame_state, preview_pipe)
    )

    def build_tracker() -> Any:
        if live_tracker_factory is None:
            raise RuntimeError("No tracker factory configured")
        if "capture_controller" in inspect.signature(live_tracker_factory).parameters:
            return live_tracker_factory(capture_controller=capture_controller)
        return live_tracker_factory()

    def command_loop() -> None:
        try:
            for raw_line in sys.stdin:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue

                command = payload.get("type")
                if command == "capture.set-label":
                    label = payload.get("label")
                    if isinstance(label, str):
                        capture_controller.set_label(cast(PoseName, label))
                elif command == "capture.start":
                    capture_controller.start()
                elif command == "capture.stop":
                    capture_controller.stop()
                elif command == "capture.discard-last":
                    capture_controller.discard_last()
                elif command == "capture.export":
                    capture_controller.export_session()
        except OSError:
            return

    command_thread = Thread(target=command_loop, name="incantation-commands", daemon=True)
    command_thread.start()
    capture_controller.emit_state(None)

    try:
        while True:
            try:
                with live_camera_factory() as camera:
                    processed += run_live_pipeline(
                        camera,
                        emit_event=emit_event,
                        tracker_factory=build_tracker,
                        machine_factory=machine_factory,
                        time_source=time_source,
                        preview_interval_s=0.0,
                        preview_enabled=preview_is_enabled,
                        preview_emitter=emit_preview,
                        max_frames=max(0, max_frames - processed),
                    )
                    if max_frames and processed >= max_frames:
                        return
            except RuntimeError as error:
                emit_camera_unavailable(str(error), emit_event, tracking_backend)
                processed += 1
                if max_frames and processed >= max_frames:
                    return
                sleep_for(LEAP_RETRY_DELAY_S if tracking_backend == "leap" else 1.0)
    finally:
        if preview_pipe is not None:
            preview_pipe.close()


def main() -> None:
    args = parse_args()
    if args.fixture is not None:
        run_fixture(args.fixture)
        return

    run_live(args.max_frames, tracking_backend=cast(TrackingBackend, args.backend))


if __name__ == "__main__":
    main()
