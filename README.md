# Incantation

Spell-inspired desktop gesture control with webcam and Leap Motion backends.

## Stack

- Electron + React + TypeScript
- Bun workspaces + Biome
- Python vision service with `uv`, `ruff`, and `ty`

## Toolchain

Incantation uses `.tool-versions` as the source of truth for language/runtime tools. Install them with [`mise`](https://mise.jdx.dev/):

```bash
curl https://mise.run | sh
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
exec $SHELL -l
mise install
```

This installs the pinned versions of `bun`, `python`, and `uv` for the repo. After that, run the project setup:

```bash
bun run setup
```

With mise activated, plain commands automatically resolve to the versions in `.tool-versions` whenever your shell is inside the repo.

Linux X11 desktop control also requires the system package documented below.

## Commands

```bash
bun run setup
bun run check:system
bun run setup:leap
bun run check:leap
bun run dev
bun run test
bun run test:leap
bun run test:report
bun run report:open
bun run test:report:open
bun run check
```

## Linux Input Requirements

Incantation currently injects desktop input on Linux through `xdotool`, which only supports X11/Xorg sessions. Native Wayland sessions are detected, but desktop input control is intentionally limited there because Wayland does not allow arbitrary global input injection.

On Debian/Ubuntu-based systems, install the runtime dependency with:

```bash
sudo apt install xdotool
```

You can check your current session type with:

```bash
echo $XDG_SESSION_TYPE
```

For full gesture-controlled mouse and keyboard actions, this should report `x11` and `xdotool --version` should succeed.

## Notes

- `bun run setup` installs Bun deps, syncs the Python vision-service environment with `uv`, and builds the workspace.
- `bun run check:system` verifies host runtime requirements such as `xdotool` on Linux X11.
- `bun run setup` and `bun run dev` run `check:system` first so missing input dependencies fail clearly before startup.
- Linux desktop input control currently requires X11/Xorg plus `xdotool`.
- Wayland support is detected but intentionally limited because native Wayland blocks arbitrary global input injection.
- `bun run setup:leap` runs the normal workspace setup, then verifies or installs the Ultraleap Linux runtime through the official apt path and builds the Python `leap` bindings into `apps/vision-service`.
- `bun run setup:leap:bindings` reinstalls only the Python `leap` bindings after the Ultraleap runtime is already present.
- `bun run check:leap` performs a read-only verification that the Ultraleap runtime files are present and that `apps/vision-service` can import the Python `leap` bindings.
- `bun run test:leap` performs a base-level Ultraleap smoke test: service status, `leapctl devices`, USB presence, and a short Python tracking probe.
- The original Leap Motion Controller (`Type: LMC`) is currently verified with the older Ultraleap Linux runtime package set documented in `docs/ultraleap-linux-runtime.md`; do not commit or redistribute Ultraleap `.deb` packages in this repo.
- The Python service supports replay fixtures so gesture behavior can be validated without a live webcam.
- The scripted Ultraleap install currently targets Ubuntu/Debian-style Linux systems with `apt-get`, `sudo`, and the official Ultraleap repository; if that repository is unavailable or Hyperion does not expose an original `LMC`, use the legally constrained private-cache workflow in `docs/ultraleap-linux-runtime.md`.
- On first live vision startup, Incantation may download the MediaPipe hand landmarker model into `~/.cache/incantation/models`.
- Default gestures are index tracking for pointer move, thumb-index pinch for click/drag with a configurable hold threshold, thumb-middle pinch for right click, and open-palm hold for mapped keybinds.
- `xdotool` is the current Linux X11 backend; Incantation warns in-app when it is missing.
- `bun run test:smoke:x11` now runs headlessly under `xvfb-run`, so it does not steal focus from your real desktop session.
- `bun run test:smoke:pipeline` adds a higher-order headless smoke suite that runs Electron + Python replay fixtures + the real X11 adapter together.
- `bun run test:report` writes JUnit XML reports to `reports/junit`, which keeps the project compatible with open-source JUnit viewers and CI parsers.
- `bun run report:open` renders an HTML report from the JUnit XML set using the open-source `xunit-viewer` tool and opens it when possible.
- `bun run test:report:open` regenerates the reports and then opens the HTML view.
- The runtime boundary is now explicit: Python emits gesture intent, Electron maps intent to actions, and the adapter injects OS events.
- The calibration screen now shows live pinch hold time and a click-vs-drag preview from the desktop action mapper.
