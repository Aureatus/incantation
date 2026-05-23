from __future__ import annotations

import importlib
import math
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Literal, cast

import numpy as np

from app.leap_config import LeapOrientation, apply_leap_orientation, resolve_leap_orientation

NormalizedLandmark = dict[str, float]


def _env_enabled(name: str, legacy_name: str, default: str = "0") -> bool:
    return (os.environ.get(name) or os.environ.get(legacy_name, default)) == "1"


@dataclass(frozen=True, slots=True)
class LeapVector:
    x: float
    y: float
    z: float


@dataclass(frozen=True, slots=True)
class LeapDigitSample:
    name: Literal["thumb", "index", "middle", "ring", "pinky"]
    is_extended: bool
    base_position: LeapVector
    tip_position: LeapVector


@dataclass(frozen=True, slots=True)
class LeapHandSample:
    id: int
    hand_type: Literal["left", "right"]
    confidence: float
    pinch_strength: float
    grab_strength: float
    palm_position: LeapVector
    stabilized_palm_position: LeapVector
    digits: dict[str, LeapDigitSample]
    preview_palm: NormalizedLandmark | None = None
    preview_index_tip: NormalizedLandmark | None = None
    preview_landmarks: list[NormalizedLandmark] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class LeapFrameSample:
    seq: int
    captured_at: float
    hands: list[LeapHandSample]
    device_name: str | None = None
    preview_frame: Any | None = None


def _clamp_unit(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def _vector_from_leap(value: Any) -> LeapVector:
    return LeapVector(x=float(value.x), y=float(value.y), z=float(value.z))


def _hand_type_label(value: Any) -> Literal["left", "right"]:
    normalized = str(value).split(".")[-1].strip().lower()
    return "left" if normalized == "left" else "right"


def _digit_sample(name: str, digit: Any) -> LeapDigitSample:
    metacarpal = digit.metacarpal
    distal = digit.distal
    return LeapDigitSample(
        name=cast(Literal["thumb", "index", "middle", "ring", "pinky"], name),
        is_extended=bool(getattr(digit, "is_extended", False)),
        base_position=_vector_from_leap(metacarpal.next_joint),
        tip_position=_vector_from_leap(distal.next_joint),
    )


def leap_hand_from_tracking_event(
    hand: Any,
    preview_landmarks: list[NormalizedLandmark] | None = None,
    preview_palm: NormalizedLandmark | None = None,
    preview_index_tip: NormalizedLandmark | None = None,
) -> LeapHandSample:
    return LeapHandSample(
        id=int(hand.id),
        hand_type=_hand_type_label(hand.type),
        confidence=float(getattr(hand, "confidence", 0.0)),
        pinch_strength=float(getattr(hand, "pinch_strength", 0.0)),
        grab_strength=float(getattr(hand, "grab_strength", 0.0)),
        palm_position=_vector_from_leap(hand.palm.position),
        stabilized_palm_position=_vector_from_leap(hand.palm.stabilized_position),
        digits={
            "thumb": _digit_sample("thumb", hand.thumb),
            "index": _digit_sample("index", hand.index),
            "middle": _digit_sample("middle", hand.middle),
            "ring": _digit_sample("ring", hand.ring),
            "pinky": _digit_sample("pinky", hand.pinky),
        },
        preview_palm=preview_palm,
        preview_index_tip=preview_index_tip,
        preview_landmarks=preview_landmarks or [],
    )


def _hand_joint_positions(hand: Any) -> list[LeapVector]:
    joints = [
        _vector_from_leap(hand.arm.prev_joint),
        _vector_from_leap(hand.arm.next_joint),
        _vector_from_leap(hand.palm.position),
    ]
    for digit in [hand.thumb, hand.index, hand.middle, hand.ring, hand.pinky]:
        for bone in [digit.metacarpal, digit.proximal, digit.intermediate, digit.distal]:
            joints.append(_vector_from_leap(bone.prev_joint))
            joints.append(_vector_from_leap(bone.next_joint))
    return joints


def _merge_preview_images(images: list[Any]) -> Any | None:
    if not images:
        return None
    if len(images) == 1:
        return images[0]

    base_shape = images[0].shape
    compatible = [image for image in images if image.shape == base_shape]
    if not compatible:
        return images[0]
    if len(compatible) == 1:
        return compatible[0]

    merged = compatible[0].copy()
    for image in compatible[1:]:
        merged = np.maximum(merged, image)
    return merged


def _merge_projected_landmarks(
    landmarks: list[NormalizedLandmark | None],
) -> NormalizedLandmark | None:
    valid = [landmark for landmark in landmarks if landmark is not None]
    if not valid:
        return None
    if len(valid) == 1:
        return valid[0]
    return {
        "x": _clamp_unit(sum(landmark["x"] for landmark in valid) / len(valid)),
        "y": _clamp_unit(sum(landmark["y"] for landmark in valid) / len(valid)),
    }


class LeapCamera:
    def __init__(
        self,
        timeout_s: float = 3.0,
        desired_orientation: LeapOrientation | None = None,
    ) -> None:
        self.timeout_s = timeout_s
        self.desired_orientation: LeapOrientation = (
            desired_orientation or resolve_leap_orientation()
        )
        self._connection: Any | None = None
        self._listener: Any | None = None
        self._condition = threading.Condition()
        self._latest_sample: LeapFrameSample | None = None
        self._last_consumed_seq = -1
        self._device_name: str | None = None
        self._configured_serial: str | None = None
        self._latest_preview_frame: Any | None = None
        self._preview_camera_widths: tuple[int, ...] = ()
        self._extrinsic_by_camera: dict[int, Any] = {}

    def _configure_orientation(self, serial: str) -> None:
        if serial == self._configured_serial:
            return

        apply_leap_orientation(serial, self.desired_orientation)
        self._configured_serial = serial

    def __enter__(self) -> LeapCamera:
        try:
            leap = cast(Any, importlib.import_module("leap"))
            leap_enums = cast(Any, importlib.import_module("leap.enums"))
            leapc_cffi = cast(Any, importlib.import_module("leapc_cffi"))
            PolicyFlag = leap_enums.PolicyFlag
            ffi = leapc_cffi.ffi
            libleapc = leapc_cffi.libleapc
        except Exception as error:  # pragma: no cover - depends on local runtime
            raise RuntimeError(
                "Leap backend requires the Ultraleap runtime and Python 'leap' bindings"
            ) from error

        camera = self

        def decode_preview_image(image: Any) -> Any | None:
            raw = image.c_data
            width = int(raw.properties.width)
            height = int(raw.properties.height)
            bpp = int(raw.properties.bpp)
            if width <= 0 or height <= 0 or bpp <= 0:
                return None

            buffer_ptr = ffi.cast("uint8_t*", raw.data)
            if buffer_ptr == ffi.NULL:
                return None

            payload_size = width * height * bpp
            payload = np.frombuffer(
                ffi.buffer(buffer_ptr + int(raw.offset), payload_size), dtype=np.uint8
            ).copy()
            if bpp == 1:
                return payload.reshape((height, width))
            return payload.reshape((height, width, bpp))

        def compose_preview_frame(images: list[Any]) -> Any | None:
            decoded_images = [
                image
                for image in (decode_preview_image(image) for image in images)
                if image is not None
            ]
            if not decoded_images:
                return None

            camera._preview_camera_widths = tuple(int(image.shape[1]) for image in decoded_images)
            return _merge_preview_images(decoded_images)

        def get_camera_extrinsic(camera_index: int) -> Any:
            cached = camera._extrinsic_by_camera.get(camera_index)
            if cached is not None:
                return cached

            matrix_ptr = ffi.new("float[]", 16)
            libleapc.LeapExtrinsicCameraMatrixByIndex(
                connection.get_connection_ptr(), camera_index, matrix_ptr
            )
            matrix = np.array(
                [float(matrix_ptr[index]) for index in range(16)], dtype=np.float64
            ).reshape((4, 4), order="F")
            camera._extrinsic_by_camera[camera_index] = matrix
            return matrix

        def project_point(point: LeapVector, camera_index: int) -> NormalizedLandmark | None:
            if not camera._preview_camera_widths:
                return None

            image_width = float(camera._preview_camera_widths[camera_index])
            preview = camera._latest_preview_frame
            if preview is None:
                return None
            image_height = float(preview.shape[0])

            extrinsic = get_camera_extrinsic(camera_index)
            rotation = extrinsic[:3, :3]
            translation = extrinsic[:3, 3]
            point_in_leap = np.array([point.x, point.y, point.z], dtype=np.float64)
            point_in_camera = rotation.T @ (point_in_leap - translation)
            if abs(float(point_in_camera[2])) < 1e-6:
                return None

            rectilinear = ffi.new("LEAP_VECTOR*")
            rectilinear[0].x = float(point_in_camera[0] / point_in_camera[2])
            rectilinear[0].y = float(point_in_camera[1] / point_in_camera[2])
            rectilinear[0].z = 1.0
            pixel = libleapc.LeapRectilinearToPixelByIndex(
                connection.get_connection_ptr(), camera_index, rectilinear[0]
            )
            pixel_x = float(pixel.x)
            pixel_y = float(pixel.y)
            if not math.isfinite(pixel_x) or not math.isfinite(pixel_y):
                return None
            if pixel_x < 0 or pixel_y < 0 or pixel_x >= image_width or pixel_y >= image_height:
                return None

            return {
                "x": _clamp_unit(pixel_x / image_width),
                "y": _clamp_unit(pixel_y / image_height),
            }

        def project_hand_landmarks(hand: Any) -> list[NormalizedLandmark]:
            if len(camera._preview_camera_widths) == 0 or camera._latest_preview_frame is None:
                return []

            projected: list[NormalizedLandmark] = []
            camera_count = min(2, len(camera._preview_camera_widths))
            for joint in _hand_joint_positions(hand):
                merged_landmark = _merge_projected_landmarks(
                    [project_point(joint, camera_index) for camera_index in range(camera_count)]
                )
                if merged_landmark is not None:
                    projected.append(merged_landmark)
            return projected

        class _Listener(leap.Listener):
            def on_device_event(self, event: Any) -> None:
                try:
                    with event.device.open():
                        info = event.device.get_info()
                except Exception:
                    info = event.device.get_info()

                serial = getattr(info, "serial", None)
                serial_string = str(serial) if serial else None
                if serial_string is not None:
                    camera._configure_orientation(serial_string)
                with camera._condition:
                    camera._device_name = serial_string or "Leap Motion Controller"
                    camera._condition.notify_all()

            def on_image_event(self, event: Any) -> None:
                preview_frame = compose_preview_frame(list(event.image))
                if preview_frame is None:
                    return

                with camera._condition:
                    camera._latest_preview_frame = preview_frame
                    camera._condition.notify_all()

            def on_tracking_event(self, event: Any) -> None:
                sample = LeapFrameSample(
                    seq=int(getattr(event, "tracking_frame_id", 0)),
                    captured_at=time.monotonic(),
                    hands=[
                        leap_hand_from_tracking_event(
                            hand,
                            preview_landmarks=project_hand_landmarks(hand),
                            preview_palm=_merge_projected_landmarks(
                                [
                                    project_point(
                                        _vector_from_leap(hand.palm.stabilized_position),
                                        camera_index,
                                    )
                                    for camera_index in range(
                                        min(2, len(camera._preview_camera_widths))
                                    )
                                ]
                            ),
                            preview_index_tip=_merge_projected_landmarks(
                                [
                                    project_point(
                                        _vector_from_leap(hand.index.distal.next_joint),
                                        camera_index,
                                    )
                                    for camera_index in range(
                                        min(2, len(camera._preview_camera_widths))
                                    )
                                ]
                            ),
                        )
                        for hand in list(event.hands)[:2]
                    ],
                    device_name=camera._device_name,
                    preview_frame=camera._latest_preview_frame,
                )
                with camera._condition:
                    camera._latest_sample = sample
                    camera._condition.notify_all()

        self._listener = _Listener()
        connection: Any = leap.Connection()
        tracking_mode = leap.TrackingMode.Desktop  # pyright: ignore[reportAttributeAccessIssue]
        connection.add_listener(self._listener)
        connection.connect()
        connection.set_tracking_mode(tracking_mode)
        if _env_enabled("INCANTATION_DEBUG_PREVIEW", "AIRLOOM_DEBUG_PREVIEW"):
            image_policy = PolicyFlag.Images  # pyright: ignore[reportAttributeAccessIssue]
            connection.set_policy_flags([image_policy], [])
        self._connection = connection
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        if self._connection is not None and self._listener is not None:
            try:
                self._connection.remove_listener(self._listener)
            except Exception:
                pass
        if self._connection is not None:
            self._connection.disconnect()
        self._connection = None
        self._listener = None

    def read(self) -> LeapFrameSample:
        return self.read_with_metadata(0)[2]

    def read_with_metadata(self, _sequence: int) -> tuple[int, float, LeapFrameSample]:
        deadline = time.monotonic() + self.timeout_s
        with self._condition:
            while True:
                sample = self._latest_sample
                if sample is not None and sample.seq != self._last_consumed_seq:
                    self._last_consumed_seq = sample.seq
                    return (sample.seq, sample.captured_at, sample)

                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    device_name = self._device_name or "Leap Motion Controller"
                    raise RuntimeError(f"No tracking frames received from {device_name}")
                self._condition.wait(timeout=remaining)
