import numpy as np

from app.leap_device import LeapDigitSample, LeapFrameSample, LeapHandSample, LeapVector
from app.leap_tracking import LeapTracker


def _vector(x: float, y: float, z: float = 0.0) -> LeapVector:
    return LeapVector(x=x, y=y, z=z)


def _digit(name: str, *, extended: bool, tip: LeapVector, base: LeapVector) -> LeapDigitSample:
    return LeapDigitSample(
        name=name,  # type: ignore[arg-type]
        is_extended=extended,
        tip_position=tip,
        base_position=base,
    )


def _hand(
    hand_id: int,
    hand_type: str,
    *,
    pinch_strength: float,
    grab_strength: float,
    palm_x: float,
    palm_y: float,
    index_extended: bool,
    middle_extended: bool,
    ring_extended: bool,
    pinky_extended: bool,
    palm_z: float = 0.0,
    thumb_extended: bool = True,
    thumb_tip: LeapVector | None = None,
    index_tip: LeapVector | None = None,
    middle_tip: LeapVector | None = None,
    stabilized_palm: LeapVector | None = None,
    preview_palm: dict[str, float] | None = None,
    preview_index_tip: dict[str, float] | None = None,
    preview_landmarks: list[dict[str, float]] | None = None,
) -> LeapHandSample:
    palm = _vector(palm_x, palm_y, palm_z)
    thumb_tip = thumb_tip or _vector(palm_x - 20, palm_y, 0)
    index_tip = index_tip or _vector(palm_x + 10, palm_y + 60, 0)
    middle_tip = middle_tip or _vector(palm_x + 25, palm_y + 55, 0)
    ring_tip = _vector(palm_x + 40, palm_y + 45, 0)
    pinky_tip = _vector(palm_x + 55, palm_y + 35, 0)
    base = _vector(palm_x, palm_y + 10, 0)
    return LeapHandSample(
        id=hand_id,
        hand_type=hand_type,  # type: ignore[arg-type]
        confidence=0.92,
        pinch_strength=pinch_strength,
        grab_strength=grab_strength,
        palm_position=palm,
        stabilized_palm_position=stabilized_palm or palm,
        digits={
            "thumb": _digit("thumb", extended=thumb_extended, tip=thumb_tip, base=base),
            "index": _digit("index", extended=index_extended, tip=index_tip, base=base),
            "middle": _digit("middle", extended=middle_extended, tip=middle_tip, base=base),
            "ring": _digit("ring", extended=ring_extended, tip=ring_tip, base=base),
            "pinky": _digit("pinky", extended=pinky_extended, tip=pinky_tip, base=base),
        },
        preview_palm=preview_palm,
        preview_index_tip=preview_index_tip,
        preview_landmarks=preview_landmarks or [],
    )


def test_leap_tracker_maps_two_hand_roles_into_frame_state() -> None:
    tracker = LeapTracker(smoothing_alpha=1.0, mirror_x=False)
    pointer_hand = _hand(
        1,
        "right",
        pinch_strength=0.1,
        grab_strength=0.9,
        palm_x=40,
        palm_y=210,
        index_extended=False,
        middle_extended=False,
        ring_extended=False,
        pinky_extended=False,
        thumb_extended=False,
    )
    action_hand = _hand(
        2,
        "left",
        pinch_strength=0.88,
        grab_strength=0.1,
        palm_x=-40,
        palm_y=225,
        index_extended=True,
        middle_extended=True,
        ring_extended=False,
        pinky_extended=False,
        thumb_tip=_vector(-30, 280, 0),
        index_tip=_vector(-28, 282, 0),
        middle_tip=_vector(-5, 278, 0),
    )

    frame = tracker.process(
        LeapFrameSample(seq=1, captured_at=1.0, hands=[pointer_hand, action_hand])
    )

    assert frame["tracking"] is True
    assert frame.get("tracking_backend") == "leap"
    assert frame.get("preview_available") is False
    assert frame.get("pointer_hand") == "right"
    assert frame.get("action_hand") == "left"
    assert frame.get("closed_fist") is True
    assert frame["pinch_strength"] == 0.88
    assert frame.get("action_pose") == "primary-pinch"
    assert frame.get("pointer") is not None


def test_leap_tracker_uses_dropout_hold_then_reports_no_hands() -> None:
    tracker = LeapTracker(smoothing_alpha=1.0, mirror_x=False, tracking_hold_frames=1)
    tracked = tracker.process(
        LeapFrameSample(
            seq=1,
            captured_at=1.0,
            hands=[
                _hand(
                    1,
                    "right",
                    pinch_strength=0.12,
                    grab_strength=0.85,
                    palm_x=0,
                    palm_y=210,
                    index_extended=False,
                    middle_extended=False,
                    ring_extended=False,
                    pinky_extended=False,
                    thumb_extended=False,
                )
            ],
            device_name="Leap Test",
        )
    )
    dropout = tracker.process(
        LeapFrameSample(seq=2, captured_at=2.0, hands=[], device_name="Leap Test")
    )
    missing = tracker.process(
        LeapFrameSample(seq=3, captured_at=3.0, hands=[], device_name="Leap Test")
    )

    assert tracked["tracking"] is True
    assert dropout.get("fallback_reason") == "dropout-hold"
    assert dropout["tracking"] is True
    assert missing["tracking"] is False
    assert missing.get("fallback_reason") == "no-hands"


def test_leap_tracker_reports_preview_metadata_and_landmarks() -> None:
    tracker = LeapTracker(smoothing_alpha=1.0, mirror_x=False)
    frame = tracker.process(
        LeapFrameSample(
            seq=1,
            captured_at=1.0,
            hands=[
                _hand(
                    1,
                    "right",
                    pinch_strength=0.1,
                    grab_strength=0.85,
                    palm_x=0,
                    palm_y=210,
                    index_extended=False,
                    middle_extended=False,
                    ring_extended=False,
                    pinky_extended=False,
                    thumb_extended=False,
                    preview_palm={"x": 0.25, "y": 0.35},
                    preview_index_tip={"x": 0.45, "y": 0.55},
                    preview_landmarks=[{"x": 0.2, "y": 0.3}, {"x": 0.4, "y": 0.5}],
                )
            ],
            device_name="Leap Test",
            preview_frame=np.array([[0, 255], [255, 0]], dtype=np.uint8),
        )
    )

    assert frame.get("preview_available") is True
    assert frame.get("pointer_mode") == "clutch"
    assert frame.get("pointer_range_min_x") == -240
    assert frame.get("pointer_range_max_x") == 240
    assert frame.get("pointer_range_min_z") == -160
    assert frame.get("pointer_range_max_z") == 160
    assert frame.get("camera_width") == 2
    assert frame.get("camera_height") == 2
    raw_pointer = frame.get("raw_pointer")
    assert raw_pointer is not None
    assert abs(raw_pointer["x"] - 0.5) < 1e-6
    assert abs(raw_pointer["y"] - 0.5) < 1e-6
    assert frame.get("preview_raw_pointer") == {"x": 0.25, "y": 0.35}
    assert frame.get("preview_pointer") == {"x": 0.25, "y": 0.35}
    assert frame.get("hand_landmarks") == [{"x": 0.2, "y": 0.3}, {"x": 0.4, "y": 0.5}]


def test_leap_tracker_clutch_starts_from_previous_pointer_position() -> None:
    tracker = LeapTracker(smoothing_alpha=1.0, mirror_x=False)
    open_hand = tracker.process(
        LeapFrameSample(
            seq=1,
            captured_at=1.0,
            hands=[
                _hand(
                    1,
                    "right",
                    pinch_strength=0.1,
                    grab_strength=0.1,
                    palm_x=0,
                    palm_y=210,
                    index_extended=True,
                    middle_extended=True,
                    ring_extended=True,
                    pinky_extended=True,
                    index_tip=_vector(140, 280, 0),
                    middle_tip=_vector(90, 270, 0),
                )
            ],
            device_name="Leap Test",
        )
    )
    clenched = tracker.process(
        LeapFrameSample(
            seq=2,
            captured_at=2.0,
            hands=[
                _hand(
                    1,
                    "right",
                    pinch_strength=0.1,
                    grab_strength=0.9,
                    palm_x=0,
                    palm_y=210,
                    index_extended=False,
                    middle_extended=False,
                    ring_extended=False,
                    pinky_extended=False,
                    thumb_extended=False,
                )
            ],
            device_name="Leap Test",
        )
    )

    open_pointer = open_hand.get("pointer")
    clenched_pointer = clenched.get("pointer")
    clenched_raw_pointer = clenched.get("raw_pointer")
    clenched_anchor = clenched.get("clutch_anchor")
    assert open_pointer is not None
    assert clenched_pointer is not None
    assert clenched_raw_pointer is not None
    assert clenched_anchor is not None
    assert open_pointer["x"] > 0.8
    assert abs(clenched_pointer["x"] - open_pointer["x"]) < 1e-6
    assert abs(clenched_raw_pointer["x"] - 0.5) < 1e-6
    assert clenched.get("pointer_mode") == "clutch"
    assert abs(clenched_anchor["x"] - 0.5) < 1e-6


def test_leap_tracker_clutch_motion_uses_leap_space_delta_when_preview_is_available() -> None:
    tracker = LeapTracker(smoothing_alpha=1.0, mirror_x=False)
    open_hand = tracker.process(
        LeapFrameSample(
            seq=1,
            captured_at=1.0,
            hands=[
                _hand(
                    1,
                    "right",
                    pinch_strength=0.1,
                    grab_strength=0.2,
                    palm_x=0,
                    palm_y=210,
                    index_extended=True,
                    middle_extended=True,
                    ring_extended=True,
                    pinky_extended=True,
                    preview_index_tip={"x": 0.4, "y": 0.4},
                )
            ],
        )
    )
    tracker.process(
        LeapFrameSample(
            seq=2,
            captured_at=2.0,
            hands=[
                _hand(
                    1,
                    "right",
                    pinch_strength=0.1,
                    grab_strength=0.9,
                    palm_x=0,
                    palm_y=210,
                    index_extended=False,
                    middle_extended=False,
                    ring_extended=False,
                    pinky_extended=False,
                    thumb_extended=False,
                    preview_palm={"x": 0.4, "y": 0.4},
                )
            ],
        )
    )
    moved = tracker.process(
        LeapFrameSample(
            seq=3,
            captured_at=3.0,
            hands=[
                _hand(
                    99,
                    "right",
                    pinch_strength=0.1,
                    grab_strength=0.9,
                    palm_x=72,
                    palm_y=210,
                    palm_z=-48,
                    index_extended=False,
                    middle_extended=False,
                    ring_extended=False,
                    pinky_extended=False,
                    thumb_extended=False,
                    stabilized_palm=_vector(0, 210, 0),
                    preview_palm={"x": 0.6, "y": 0.55},
                )
            ],
        )
    )

    open_pointer = open_hand.get("pointer")
    moved_pointer = moved.get("pointer")
    moved_preview_anchor = moved.get("preview_clutch_anchor")
    assert open_pointer is not None
    assert moved_pointer is not None
    assert moved_preview_anchor == {"x": 0.4, "y": 0.4}
    assert moved.get("preview_pointer") == {"x": 0.6, "y": 0.55}
    assert abs((moved.get("clutch_delta_x") or 0) - (0.15 / 0.76)) < 1e-6
    assert abs((moved.get("clutch_delta_y") or 0) - (-0.15 / 0.88)) < 1e-6
    assert moved_pointer["x"] > 0.55
    assert moved_pointer["y"] < open_pointer["y"]
