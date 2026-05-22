import { spawn, spawnSync } from "node:child_process";
import type { InputAdapter, PointerButton, PointerPosition } from "./types";

export const isXdotoolInstalled = () => {
  return spawnSync("xdotool", ["--version"], { stdio: "ignore" }).status === 0;
};

export const getLinuxX11DependencyWarning = () => {
  if (process.platform !== "linux" || !process.env.DISPLAY) {
    return null;
  }

  if (isXdotoolInstalled()) {
    return null;
  }

  return "Linux X11 desktop input control requires xdotool. Install it with `sudo apt install xdotool`. Wayland input control is intentionally limited.";
};

const runXdotool = async (args: string[]) => {
  await new Promise<void>((resolve, reject) => {
    if (!isXdotoolInstalled()) {
      reject(
        new Error(getLinuxX11DependencyWarning() ?? "xdotool is not installed"),
      );
      return;
    }

    const child = spawn("xdotool", args);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`xdotool exited with code ${code ?? -1}`));
    });
  });
};

const runXdotoolCapture = async (args: string[]) => {
  return await new Promise<string>((resolve, reject) => {
    if (!isXdotoolInstalled()) {
      reject(
        new Error(getLinuxX11DependencyWarning() ?? "xdotool is not installed"),
      );
      return;
    }

    const child = spawn("xdotool", args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        new Error(
          `xdotool exited with code ${code ?? -1}${stderr ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });
};

const buttonCode = (button: PointerButton) => {
  if (button === "left") {
    return "1";
  }
  if (button === "middle") {
    return "2";
  }
  return "3";
};

const normalizeKeyToken = (token: string) => {
  const normalized = token.trim().toLowerCase();

  switch (normalized) {
    case "ctrl":
    case "control":
      return "ctrl";
    case "alt":
    case "option":
      return "alt";
    case "cmd":
    case "command":
    case "meta":
    case "super":
    case "win":
    case "windows":
      return "super";
    case "shift":
      return "shift";
    case "space":
    case "spacebar":
      return "space";
    case "enter":
      return "Return";
    case "esc":
      return "Escape";
    case "tab":
      return "Tab";
    default:
      if (/^f\d+$/i.test(token.trim())) {
        return token.trim().toUpperCase();
      }

      return token.trim();
  }
};

export const normalizeXdotoolKeyBinding = (binding: string) => {
  return binding
    .split("+")
    .map((token) => normalizeKeyToken(token))
    .filter((token) => token.length > 0)
    .join("+");
};

export const splitXdotoolKeyBinding = (binding: string) => {
  return normalizeXdotoolKeyBinding(binding)
    .split("+")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
};

const keyDownSequence = (binding: string) => {
  const parts = splitXdotoolKeyBinding(binding);
  if (parts.length <= 1) {
    return [["keydown", parts[0] ?? normalizeXdotoolKeyBinding(binding)]];
  }

  const modifiers = parts.slice(0, -1);
  const mainKey = parts.at(-1) ?? parts[0];
  return [...modifiers.map((part) => ["keydown", part]), ["keydown", mainKey]];
};

const keyUpSequence = (binding: string) => {
  const parts = splitXdotoolKeyBinding(binding);
  if (parts.length <= 1) {
    return [["keyup", parts[0] ?? normalizeXdotoolKeyBinding(binding)]];
  }

  const modifiers = parts.slice(0, -1);
  const mainKey = parts.at(-1) ?? parts[0];
  return [
    ["keyup", mainKey],
    ...modifiers.reverse().map((part) => ["keyup", part]),
  ];
};

export const createLinuxX11Adapter = (): InputAdapter => {
  return {
    platform: "linux-x11",
    isAvailable: () =>
      process.platform === "linux" && Boolean(process.env.DISPLAY),
    getPointerPosition: async () => {
      const output = await runXdotoolCapture(["getmouselocation", "--shell"]);
      const values = Object.fromEntries(
        output
          .trim()
          .split(/\r?\n/)
          .map((line) => {
            const [key, value] = line.split("=", 2);
            return [key, Number(value)];
          }),
      );

      return {
        x: Number(values.X ?? 0),
        y: Number(values.Y ?? 0),
      };
    },
    movePointer: async (position: PointerPosition) => {
      await runXdotool([
        "mousemove",
        `${Math.round(position.x)}`,
        `${Math.round(position.y)}`,
      ]);
    },
    scroll: async (amount: number) => {
      const steps = Math.max(0, Math.round(Math.abs(amount)));
      if (steps === 0) {
        return;
      }

      await runXdotool([
        "click",
        "--repeat",
        `${steps}`,
        amount > 0 ? "5" : "4",
      ]);
    },
    pointerDown: async (button: PointerButton) => {
      await runXdotool(["mousedown", buttonCode(button)]);
    },
    pointerUp: async (button: PointerButton) => {
      await runXdotool(["mouseup", buttonCode(button)]);
    },
    click: async (button: PointerButton) => {
      await runXdotool(["click", buttonCode(button)]);
    },
    keyDown: async (key: string) => {
      for (const args of keyDownSequence(key)) {
        await runXdotool(args);
      }
    },
    keyUp: async (key: string) => {
      for (const args of keyUpSequence(key)) {
        await runXdotool(args);
      }
    },
    tapKey: async (key: string) => {
      await runXdotool(["key", normalizeXdotoolKeyBinding(key)]);
    },
  };
};
