import { spawnSync } from "node:child_process";

const installCommand = "sudo apt install xdotool";

const hasCommand = (command: string) => {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
};

if (process.platform !== "linux") {
  process.exit(0);
}

const sessionType = process.env.XDG_SESSION_TYPE?.toLowerCase() ?? "unknown";
const hasDisplay = Boolean(process.env.DISPLAY);

if (sessionType === "wayland") {
  console.warn(
    [
      "Incantation warning: native Wayland desktop input is intentionally limited.",
      "Full mouse/keyboard gesture actions currently require an X11/Xorg session and xdotool.",
    ].join("\n"),
  );
  process.exit(0);
}

if (!hasDisplay) {
  process.exit(0);
}

if (hasCommand("xdotool")) {
  process.exit(0);
}

console.error(
  [
    "Incantation setup error: xdotool is required for Linux X11 desktop input control.",
    "Gesture recognition can run without it, but mouse movement, clicks, and key presses will not work.",
    `Install it with: ${installCommand}`,
    "Incantation currently supports full Linux input injection on X11/Xorg only; Wayland is intentionally limited.",
  ].join("\n"),
);

process.exit(1);
