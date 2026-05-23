from __future__ import annotations

import argparse
import importlib
import subprocess
import sys
import time
from dataclasses import dataclass, field
from typing import Any, cast

# pyright: reportMissingImports=false


@dataclass(slots=True)
class ProbeState:
    connected: bool = False
    device_serials: list[str] = field(default_factory=list)
    tracking_frames: int = 0
    hand_frames: int = 0
    last_hand_count: int = 0
    errors: list[str] = field(default_factory=list)


def _run_command(command: list[str]) -> tuple[int, str]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        return (127, "command not found")

    output = (result.stdout or result.stderr).strip()
    return (result.returncode, output)


def _print_section(title: str) -> None:
    print(f"\n== {title} ==")


def _print_command_result(label: str, command: list[str]) -> None:
    code, output = _run_command(command)
    print(f"{label}: exit {code}")
    if output:
        print(output)


def _make_listener(state: ProbeState):
    leap = cast(Any, importlib.import_module("leap"))

    class SmokeListener(leap.Listener):
        def on_connection_event(self, event: Any) -> None:
            del event
            state.connected = True
            print("leap connection: connected")

        def on_device_event(self, event: Any) -> None:
            try:
                with event.device.open():
                    info = event.device.get_info()
            except Exception:
                info = event.device.get_info()

            serial = str(getattr(info, "serial", "unknown"))
            if serial not in state.device_serials:
                state.device_serials.append(serial)
            print(f"leap device: {serial}")

        def on_tracking_event(self, event: Any) -> None:
            state.tracking_frames += 1
            hand_count = len(event.hands)
            state.last_hand_count = hand_count
            if hand_count > 0:
                state.hand_frames += 1
            if state.tracking_frames <= 5 or hand_count > 0:
                print(f"tracking frame {event.tracking_frame_id}: hands={hand_count}")

        def on_log_event(self, event: Any) -> None:
            severity = getattr(getattr(event, "severity", None), "name", "log")
            message = str(getattr(event, "message", ""))
            if message:
                state.errors.append(f"{severity}: {message}")

    return SmokeListener()


def run_probe(duration_s: float) -> int:
    try:
        leap = cast(Any, importlib.import_module("leap"))
    except Exception as error:
        print(f"Unable to import Python 'leap' bindings: {error}")
        return 1

    state = ProbeState()
    listener = _make_listener(state)
    connection = leap.Connection()
    connection.add_listener(listener)
    tracking_mode = leap.TrackingMode.Desktop  # pyright: ignore[reportAttributeAccessIssue]

    started_at = time.monotonic()
    print(f"waiting up to {duration_s:.1f}s for device and tracking events...")
    with connection.open():
        connection.set_tracking_mode(tracking_mode)
        while time.monotonic() - started_at < duration_s:
            if state.hand_frames > 0:
                break
            time.sleep(0.2)

    _print_section("summary")
    print(f"connection event: {'yes' if state.connected else 'no'}")
    print("device events: " + (", ".join(state.device_serials) if state.device_serials else "none"))
    print(f"tracking frames: {state.tracking_frames}")
    print(f"frames with hands: {state.hand_frames}")
    print(f"last hand count: {state.last_hand_count}")
    if state.errors:
        print("recent log events:")
        for entry in state.errors[-5:]:
            print(f"- {entry}")

    if state.hand_frames > 0:
        print("result: tracking is alive")
        return 0

    if state.connected and not state.device_serials:
        print("result: client can reach leapd, but leapd is not exposing a device")
        return 2

    if state.device_serials and state.tracking_frames == 0:
        print("result: device is visible, but no tracking frames arrived")
        return 3

    print("result: no usable Leap tracking yet")
    return 4


def main() -> int:
    parser = argparse.ArgumentParser(description="Base-level Ultraleap smoke test")
    parser.add_argument(
        "--duration",
        type=float,
        default=5.0,
        help="seconds to wait for tracking before failing",
    )
    args = parser.parse_args()

    _print_section("system")
    _print_command_result(
        "service status",
        ["systemctl", "is-active", "ultraleap-hand-tracking-service"],
    )
    _print_command_result("leapctl devices", ["leapctl", "devices"])
    if sys.platform.startswith("linux"):
        _print_command_result("lsusb", ["lsusb"])

    _print_section("python probe")
    return run_probe(args.duration)


if __name__ == "__main__":
    raise SystemExit(main())
