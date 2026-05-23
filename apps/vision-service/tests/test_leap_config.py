import subprocess

from app.leap_config import apply_leap_orientation, resolve_leap_orientation


def test_resolve_leap_orientation_defaults_to_normal(monkeypatch) -> None:
    monkeypatch.delenv("INCANTATION_LEAP_ORIENTATION", raising=False)
    monkeypatch.delenv("AIRLOOM_LEAP_ORIENTATION", raising=False)
    assert resolve_leap_orientation() == "normal"


def test_resolve_leap_orientation_accepts_inverted(monkeypatch) -> None:
    monkeypatch.setenv("INCANTATION_LEAP_ORIENTATION", "inverted")
    assert resolve_leap_orientation() == "inverted"


def test_apply_leap_orientation_invokes_leapctl() -> None:
    calls: list[list[str]] = []

    def fake_runner(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, stdout="ok", stderr="")

    applied = apply_leap_orientation(
        "LP123",
        "inverted",
        runner=fake_runner,
        command_exists=lambda _name: "/usr/bin/leapctl",
    )

    assert applied is True
    assert calls == [["leapctl", "config", "orientation", "--device", "LP123", "inverted"]]


def test_apply_leap_orientation_handles_missing_leapctl() -> None:
    applied = apply_leap_orientation(
        "LP123",
        "normal",
        command_exists=lambda _name: None,
    )

    assert applied is False
