from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, cast

from app.hand_tracking import (
    _clamp_unit,
    _remap_pointer_axis,
    _select_hand_roles,
    _vertical_pointer_margin,
)
from app.leap_device import LeapDigitSample, LeapFrameSample, LeapHandSample, LeapVector
from app.protocol import (
    FrameState,
    Landmark,
    PoseName,
    PoseScores,
    empty_pose_scores,
    pose_scores_for_pose,
)
from app.smoothing import ExponentialSmoother


def _env_value(name: str, legacy_name: str, default: str) -> str:
    return os.environ.get(name) or os.environ.get(legacy_name, default)


def _distance(a: LeapVector, b: LeapVector) -> float:
    return ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2) ** 0.5


def _normalize(value: float, minimum: float, maximum: float) -> float:
    if maximum <= minimum:
        return 0.5
    return _clamp_unit((value - minimum) / (maximum - minimum))


def _make_landmark(x: float, y: float) -> dict[str, float]:
    return {"x": _clamp_unit(x), "y": _clamp_unit(y)}


def _digit(hand: LeapHandSample, name: str) -> LeapDigitSample:
    return hand.digits[name]


def _extended_finger_count(hand: LeapHandSample) -> int:
    return sum(1 for digit in hand.digits.values() if digit.is_extended)


def _secondary_pinch_strength(hand: LeapHandSample) -> float:
    thumb_tip = _digit(hand, "thumb").tip_position
    middle_tip = _digit(hand, "middle").tip_position
    distance = _distance(thumb_tip, middle_tip)
    return _clamp_unit(1.0 - distance / 45.0)


def _pose_for_hand(hand: LeapHandSample) -> tuple[PoseName, float, PoseScores, float]:
    primary_pinch = _clamp_unit(hand.pinch_strength)
    secondary_pinch = _secondary_pinch_strength(hand)
    grab_strength = _clamp_unit(hand.grab_strength)
    index_extended = _digit(hand, "index").is_extended
    middle_extended = _digit(hand, "middle").is_extended
    ring_extended = _digit(hand, "ring").is_extended
    pinky_extended = _digit(hand, "pinky").is_extended
    thumb_extended = _digit(hand, "thumb").is_extended
    extended_count = _extended_finger_count(hand)

    if grab_strength >= 0.82 or extended_count <= 1:
        pose: PoseName = "closed-fist"
        confidence = max(0.72, grab_strength)
    elif primary_pinch >= 0.72:
        pose = "primary-pinch"
        confidence = primary_pinch
    elif secondary_pinch >= 0.7:
        pose = "secondary-pinch"
        confidence = secondary_pinch
    elif index_extended and middle_extended and not ring_extended and not pinky_extended:
        pose = "peace-sign"
        confidence = 0.88
    elif (
        index_extended
        and middle_extended
        and ring_extended
        and pinky_extended
        and not thumb_extended
        and primary_pinch < 0.5
        and secondary_pinch < 0.5
    ):
        pose = "blade-hand"
        confidence = 0.82
    elif (
        index_extended
        and middle_extended
        and ring_extended
        and pinky_extended
        and grab_strength < 0.28
    ):
        pose = "open-palm"
        confidence = 0.84
    else:
        pose = "neutral"
        confidence = 0.65

    return (pose, confidence, pose_scores_for_pose(pose, confidence), secondary_pinch)


@dataclass(frozen=True, slots=True)
class _TrackedLeapHand:
    hand_id: int
    handedness: str
    confidence: float
    pose: PoseName
    pose_confidence: float
    pose_scores: PoseScores
    primary_pinch_strength: float
    secondary_pinch_strength: float
    open_palm_hold: bool
    closed_fist: bool
    raw_pointer: Landmark
    preview_pointer: Landmark | None
    center: Landmark
    preview_landmarks: list[Landmark]


@dataclass
class LeapTracker:
    capture_controller: Any | None = None
    smoothing_alpha: float = field(
        default_factory=lambda: float(
            _env_value("INCANTATION_SMOOTHING_ALPHA", "AIRLOOM_SMOOTHING_ALPHA", "0.72")
        )
    )
    mirror_x: bool = field(
        default_factory=lambda: _env_value("INCANTATION_MIRROR_X", "AIRLOOM_MIRROR_X", "0") != "0"
    )
    tracking_hold_frames: int = field(
        default_factory=lambda: int(
            _env_value("INCANTATION_TRACKING_HOLD_FRAMES", "AIRLOOM_TRACKING_HOLD_FRAMES", "3")
        )
    )
    pointer_region_margin: float = field(
        default_factory=lambda: float(
            _env_value(
                "INCANTATION_POINTER_REGION_MARGIN",
                "AIRLOOM_POINTER_REGION_MARGIN",
                "0.12",
            )
        )
    )
    pointer_x_min_mm: float = field(
        default_factory=lambda: float(
            _env_value("INCANTATION_LEAP_POINTER_MIN_X", "AIRLOOM_LEAP_POINTER_MIN_X", "-240")
        )
    )
    pointer_x_max_mm: float = field(
        default_factory=lambda: float(
            _env_value("INCANTATION_LEAP_POINTER_MAX_X", "AIRLOOM_LEAP_POINTER_MAX_X", "240")
        )
    )
    pointer_z_min_mm: float = field(
        default_factory=lambda: float(
            _env_value("INCANTATION_LEAP_POINTER_MIN_Z", "AIRLOOM_LEAP_POINTER_MIN_Z", "-160")
        )
    )
    pointer_z_max_mm: float = field(
        default_factory=lambda: float(
            _env_value("INCANTATION_LEAP_POINTER_MAX_Z", "AIRLOOM_LEAP_POINTER_MAX_Z", "160")
        )
    )
    _smoother: ExponentialSmoother = field(init=False)
    _last_frame_state: FrameState | None = field(init=False, default=None)
    _tracking_hold_remaining: int = field(init=False, default=0)
    _clutch_hand_key: str | None = field(init=False, default=None)
    _clutch_anchor_raw_pointer: Landmark | None = field(init=False, default=None)
    _clutch_anchor_preview_pointer: Landmark | None = field(init=False, default=None)
    _clutch_output_origin: Landmark | None = field(init=False, default=None)

    def __post_init__(self) -> None:
        self._smoother = ExponentialSmoother(alpha=self.smoothing_alpha)

    def _normalized_pointer(self, point: LeapVector) -> dict[str, float]:
        normalized_x = _normalize(point.x, self.pointer_x_min_mm, self.pointer_x_max_mm)
        if self.mirror_x:
            normalized_x = 1.0 - normalized_x
        normalized_y = _normalize(point.z, self.pointer_z_min_mm, self.pointer_z_max_mm)
        return {
            "x": _remap_pointer_axis(normalized_x, self.pointer_region_margin),
            "y": _remap_pointer_axis(
                normalized_y,
                _vertical_pointer_margin(self.pointer_region_margin),
            ),
        }

    def _pointer_anchor(self, hand: LeapHandSample, pose: PoseName) -> LeapVector:
        if pose in {"closed-fist", "blade-hand"}:
            return hand.palm_position
        return _digit(hand, "index").tip_position

    def _preview_pointer(self, hand: LeapHandSample, pose: PoseName) -> Landmark | None:
        candidate = (
            hand.preview_palm if pose in {"closed-fist", "blade-hand"} else hand.preview_index_tip
        )
        if candidate is None:
            return None
        return cast(Landmark, {"x": candidate["x"], "y": candidate["y"]})

    def _center_point(self, hand: LeapHandSample) -> dict[str, float]:
        return self._normalized_pointer(hand.stabilized_palm_position)

    def _clear_clutch_anchor(self) -> None:
        self._clutch_hand_key = None
        self._clutch_anchor_raw_pointer = None
        self._clutch_anchor_preview_pointer = None
        self._clutch_output_origin = None

    def _pointer_from_clutch(self, hand: _TrackedLeapHand) -> Landmark:
        current_raw = hand.raw_pointer
        hand_key = hand.handedness
        if (
            self._clutch_hand_key != hand_key
            or self._clutch_anchor_raw_pointer is None
            or self._clutch_output_origin is None
        ):
            self._clutch_hand_key = hand_key
            self._clutch_anchor_raw_pointer = current_raw
            self._clutch_anchor_preview_pointer = hand.preview_pointer
            last_pointer = self._last_frame_state.get("pointer") if self._last_frame_state else None
            self._clutch_output_origin = last_pointer or current_raw
            return cast(Landmark, dict(self._clutch_output_origin))

        delta_x = current_raw["x"] - self._clutch_anchor_raw_pointer["x"]
        delta_y = current_raw["y"] - self._clutch_anchor_raw_pointer["y"]
        return {
            "x": _clamp_unit(self._clutch_output_origin["x"] + delta_x),
            "y": _clamp_unit(self._clutch_output_origin["y"] + delta_y),
        }

    def _track_hand(self, hand: LeapHandSample) -> _TrackedLeapHand:
        pose, pose_confidence, pose_scores, secondary_pinch_strength = _pose_for_hand(hand)
        raw_pointer = cast(Landmark, self._normalized_pointer(self._pointer_anchor(hand, pose)))
        center = hand.preview_palm or self._center_point(hand)
        return _TrackedLeapHand(
            hand_id=hand.id,
            handedness=hand.hand_type,
            confidence=hand.confidence,
            pose=pose,
            pose_confidence=pose_confidence,
            pose_scores=pose_scores,
            primary_pinch_strength=_clamp_unit(hand.pinch_strength),
            secondary_pinch_strength=secondary_pinch_strength,
            open_palm_hold=pose == "open-palm",
            closed_fist=pose == "closed-fist",
            raw_pointer=raw_pointer,
            preview_pointer=self._preview_pointer(hand, pose),
            center=cast(Landmark, center),
            preview_landmarks=cast(list[Landmark], hand.preview_landmarks),
        )

    def _preview_details(
        self, frame: LeapFrameSample
    ) -> tuple[bool, float, int | None, int | None]:
        preview = frame.preview_frame
        if preview is None or not hasattr(preview, "shape"):
            return (False, 0.5, None, None)

        height = int(preview.shape[0])
        width = int(preview.shape[1])
        brightness = max(0.0, min(1.0, float(preview.mean()) / 255.0))
        return (True, brightness, width, height)

    def _fallback_frame_state(self, frame: LeapFrameSample) -> FrameState:
        preview_available, brightness, preview_width, preview_height = self._preview_details(frame)
        if self._last_frame_state is not None and self._tracking_hold_remaining > 0:
            self._tracking_hold_remaining -= 1
            held_state = cast(FrameState, dict(self._last_frame_state))
            held_state["confidence"] = 0.0
            held_state["fallback_reason"] = "dropout-hold"
            return held_state

        self._last_frame_state = None
        self._tracking_hold_remaining = 0
        frame_state: FrameState = {
            "tracking": False,
            "tracking_backend": "leap",
            "preview_available": preview_available,
            "pointer_mode": "free",
            "pointer_range_min_x": self.pointer_x_min_mm,
            "pointer_range_max_x": self.pointer_x_max_mm,
            "pointer_range_min_z": self.pointer_z_min_mm,
            "pointer_range_max_z": self.pointer_z_max_mm,
            "pose": "unknown",
            "pose_confidence": 0.0,
            "pose_scores": empty_pose_scores(),
            "classifier_mode": "rules",
            "model_version": None,
            "pinch_strength": 0.0,
            "secondary_pinch_strength": 0.0,
            "open_palm_hold": False,
            "closed_fist": False,
            "confidence": 0.0,
            "brightness": brightness,
            "fallback_reason": "no-hands",
        }
        if frame.device_name is not None:
            frame_state["device_name"] = frame.device_name
        if preview_width is not None and preview_height is not None:
            frame_state["camera_width"] = preview_width
            frame_state["camera_height"] = preview_height
        return frame_state

    def process(self, frame: LeapFrameSample) -> FrameState:
        preview_available, brightness, preview_width, preview_height = self._preview_details(frame)
        if not frame.hands:
            self._clear_clutch_anchor()
            return self._fallback_frame_state(frame)

        tracked_hands = [self._track_hand(hand) for hand in frame.hands[:2]]
        pointer_index, action_index = _select_hand_roles(
            [hand.center for hand in tracked_hands],
            self.mirror_x,
            [hand.handedness for hand in tracked_hands],
        )
        pointer_hand = tracked_hands[pointer_index]
        action_hand = tracked_hands[action_index]
        pointer_mode = "clutch" if pointer_hand.closed_fist else "free"
        pointer_target = (
            self._pointer_from_clutch(pointer_hand)
            if pointer_hand.closed_fist
            else pointer_hand.raw_pointer
        )
        if not pointer_hand.closed_fist:
            self._clear_clutch_anchor()
        smooth_x, smooth_y = self._smoother.update(
            pointer_target["x"],
            pointer_target["y"],
        )

        frame_state: FrameState = {
            "tracking": True,
            "tracking_backend": "leap",
            "preview_available": preview_available,
            "pointer_mode": pointer_mode,
            "pointer_range_min_x": self.pointer_x_min_mm,
            "pointer_range_max_x": self.pointer_x_max_mm,
            "pointer_range_min_z": self.pointer_z_min_mm,
            "pointer_range_max_z": self.pointer_z_max_mm,
            "pointer": cast(Landmark, _make_landmark(smooth_x, smooth_y)),
            "raw_pointer": pointer_hand.raw_pointer,
            "pose": pointer_hand.pose,
            "pose_confidence": pointer_hand.pose_confidence,
            "pose_scores": pointer_hand.pose_scores,
            "classifier_mode": "rules",
            "model_version": None,
            "pinch_strength": action_hand.primary_pinch_strength,
            "secondary_pinch_strength": action_hand.secondary_pinch_strength,
            "action_pose": action_hand.pose,
            "action_pose_confidence": action_hand.pose_confidence,
            "action_pose_scores": action_hand.pose_scores,
            "action_pinch_strength": action_hand.primary_pinch_strength,
            "action_secondary_pinch_strength": action_hand.secondary_pinch_strength,
            "action_open_palm_hold": action_hand.open_palm_hold,
            "action_hand_separate": pointer_index != action_index,
            "action_pointer": action_hand.raw_pointer,
            "pointer_hand": pointer_hand.handedness,
            "action_hand": action_hand.handedness,
            "open_palm_hold": action_hand.open_palm_hold,
            "closed_fist": pointer_hand.closed_fist,
            "confidence": max(pointer_hand.confidence, action_hand.confidence),
            "brightness": brightness,
        }
        if pointer_hand.preview_pointer is not None:
            frame_state["preview_raw_pointer"] = pointer_hand.preview_pointer
            frame_state["preview_pointer"] = pointer_hand.preview_pointer
        if self._clutch_anchor_raw_pointer is not None:
            frame_state["clutch_anchor"] = self._clutch_anchor_raw_pointer
            frame_state["clutch_delta_x"] = (
                pointer_hand.raw_pointer["x"] - self._clutch_anchor_raw_pointer["x"]
            )
            frame_state["clutch_delta_y"] = (
                pointer_hand.raw_pointer["y"] - self._clutch_anchor_raw_pointer["y"]
            )
        if self._clutch_anchor_preview_pointer is not None:
            frame_state["preview_clutch_anchor"] = self._clutch_anchor_preview_pointer
        if pointer_index != action_index and action_hand.preview_pointer is not None:
            frame_state["preview_action_pointer"] = action_hand.preview_pointer
        if frame.device_name is not None:
            frame_state["device_name"] = frame.device_name
        if preview_width is not None and preview_height is not None:
            frame_state["camera_width"] = preview_width
            frame_state["camera_height"] = preview_height
        if pointer_hand.preview_landmarks:
            frame_state["hand_landmarks"] = pointer_hand.preview_landmarks
        if pointer_index != action_index and action_hand.preview_landmarks:
            frame_state["action_hand_landmarks"] = action_hand.preview_landmarks
        if len(tracked_hands) == 1:
            frame_state["fallback_reason"] = "single-hand-mode"

        self._last_frame_state = frame_state
        self._tracking_hold_remaining = max(0, self.tracking_hold_frames)
        return frame_state
