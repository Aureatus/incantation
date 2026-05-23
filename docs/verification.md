# Verification

## Local commands

```bash
bun run setup
bun run dev
bun test apps/desktop/tests/main
uv run --directory apps/vision-service pytest
uv run --directory apps/vision-service python -m app.main --stdio --fixture tests/fixtures/landmark_sequences/open-palm-enter.json
bun run test:report
bun run report:open
bun run test:report:open
bun run test:smoke:x11
bun run test:smoke:pipeline
```

## Validation strategy

- Use replay fixtures for deterministic gesture validation.
- Use Electron mock buttons to exercise click/key paths without a live webcam.
- Use `bun run test:leap` for a base-level Leap Motion smoke test after the Ultraleap runtime and Python bindings are installed.
- On Linux X11, install `xdotool` to enable real pointer and key injection.
- `bun run test:smoke:x11` runs inside `xvfb-run`, launches an isolated X11 session, drives the real Linux X11 adapter against an `xev` target window, and expects left click, right click, and `Return` to land there without stealing focus from your real session.
- `bun run test:smoke:pipeline` is a higher-order headless smoke suite: it launches Electron without a window, runs multiple realistic Python replay fixtures through the real vision-service process, and checks click, drag-release, right click, and `Return` behavior on an isolated X11 target.
- Replay fixtures can now carry metadata (`name`, `description`, `expected`) and the pipeline smoke prints a per-scenario summary with observed counts and elapsed time.
- `bun run test:report` writes JUnit XML into `reports/junit` for `pytest`, `test:smoke:x11`, and `test:smoke:pipeline`, which keeps the project on the lightweight route while staying compatible with open-source JUnit viewers later.
- `bun run report:open` renders the current XML set into `reports/html/index.html` using `xunit-viewer` and attempts to open it with the local desktop opener.
- `bun run test:report:open` is the convenience command when you want a fresh run and then a report window immediately.
- `xdotool` is the best current default for X11 because it is simple and battle-tested, but it is not usually installed by default on many distros.
- Alternatives exist, such as `ydotool` and `xte`, but they are either less universal, more awkward to ship, or a worse fit for Incantation's current X11-first architecture.
