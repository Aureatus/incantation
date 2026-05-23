from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from typing import Any, Literal

LeapOrientation = Literal["normal", "inverted"]


def resolve_leap_orientation() -> LeapOrientation:
    raw = (
        (
            os.environ.get("INCANTATION_LEAP_ORIENTATION")
            or os.environ.get("AIRLOOM_LEAP_ORIENTATION")
            or "normal"
        )
        .strip()
        .lower()
    )
    if raw == "inverted":
        return "inverted"
    return "normal"


def apply_leap_orientation(
    serial: str,
    orientation: LeapOrientation,
    *,
    runner: Callable[..., Any] = subprocess.run,
    command_exists: Callable[[str], str | None] = shutil.which,
) -> bool:
    if command_exists("leapctl") is None:
        print(
            "vision service: unable to apply Leap orientation automatically "
            "because leapctl is missing",
            file=sys.stderr,
            flush=True,
        )
        return False

    result = runner(
        ["leapctl", "config", "orientation", "--device", serial, orientation],
        capture_output=True,
        check=False,
        text=True,
        timeout=5,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "unknown error").strip()
        print(
            f"vision service: unable to set Leap orientation to {orientation} "
            f"for {serial}: {detail}",
            file=sys.stderr,
            flush=True,
        )
        return False

    return True
