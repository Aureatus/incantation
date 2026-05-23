import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const visionServiceArg = "apps/vision-service";
const visionServiceDir = resolve(rootDir, visionServiceArg);
const visionPython = resolve(visionServiceDir, ".venv", "bin", "python");
const bindingsRepo = "https://github.com/ultraleap/leapc-python-bindings.git";
const keyUrl = "https://repo.ultraleap.com/keys/apt/gpg";
const repoLine =
  "deb [arch=amd64] https://repo.ultraleap.com/apt stable main\n";

type Options = {
  skipSystem: boolean;
  skipBindings: boolean;
  verifyOnly: boolean;
  help: boolean;
};

const parseArgs = (): Options => {
  const args = new Set(process.argv.slice(2));
  return {
    skipSystem: args.has("--skip-system"),
    skipBindings: args.has("--skip-bindings"),
    verifyOnly: args.has("--verify-only"),
    help: args.has("--help") || args.has("-h"),
  };
};

const printHelp = () => {
  console.log(`Usage: bun scripts/setup-leap.ts [options]

Verifies or installs the Ultraleap Linux runtime on Linux/amd64 via the
official apt path, then builds and installs the Python 'leap' bindings into
apps/vision-service.

Options:
  --skip-system    Skip the apt-based Ultraleap runtime install
  --skip-bindings  Skip the Python bindings build/install step
  --verify-only    Only verify the runtime files and Python import
  -h, --help       Show this help message

Examples:
  bun run setup:leap
  bun run setup:leap:bindings
  bun scripts/setup-leap.ts --verify-only
`);
};

const fail = (message: string): never => {
  throw new Error(message);
};

const run = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe";
  } = {},
) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(" ")}`);
  }

  return result.stdout?.trim() ?? "";
};

const requireLinuxAmd64 = () => {
  if (process.platform !== "linux") {
    fail("Leap setup is currently scripted only for Linux.");
  }
  if (process.arch !== "x64") {
    fail("Leap setup currently supports Linux amd64/x64 only.");
  }
};

const commandExists = (command: string) => {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    cwd: rootDir,
    stdio: "ignore",
  });
  return result.status === 0;
};

const runAsRoot = (command: string, args: string[]) => {
  if (process.getuid?.() === 0) {
    return run(command, args);
  }
  if (!commandExists("sudo")) {
    fail(`'sudo' is required to run ${command}.`);
  }
  return run("sudo", [command, ...args]);
};

const resolveRuntimePaths = () => {
  const sdkRoot = process.env.LEAPSDK_INSTALL_LOCATION;
  if (sdkRoot) {
    return {
      headerPath: process.env.LEAPC_HEADER_OVERRIDE ?? join(sdkRoot, "LeapC.h"),
      libPath: process.env.LEAPC_LIB_OVERRIDE ?? join(sdkRoot, "libLeapC.so"),
    };
  }

  return {
    headerPath: process.env.LEAPC_HEADER_OVERRIDE ?? "/usr/include/LeapC.h",
    libPath:
      process.env.LEAPC_LIB_OVERRIDE ??
      "/usr/lib/ultraleap-hand-tracking-service/libLeapC.so",
  };
};

const verifyRuntimeFiles = () => {
  const { headerPath, libPath } = resolveRuntimePaths();
  if (!existsSync(headerPath)) {
    fail(`LeapC header not found at ${headerPath}.`);
  }
  if (!existsSync(libPath)) {
    fail(`LeapC shared library not found at ${libPath}.`);
  }
  console.log("Ultraleap runtime detected:");
  console.log(`- header: ${headerPath}`);
  console.log(`- library: ${libPath}`);
};

const installUltraleapRuntime = async () => {
  const { libPath } = resolveRuntimePaths();
  if (existsSync(libPath)) {
    console.log(
      `Ultraleap runtime already present at ${libPath}; skipping apt install.`,
    );
    return;
  }

  if (!commandExists("apt-get")) {
    fail(
      "This scripted Ultraleap install expects apt-get (Ubuntu/Debian style systems).",
    );
  }

  console.log(
    "Installing Ultraleap runtime from the official apt repository...",
  );
  runAsRoot("apt-get", ["update"]);
  runAsRoot("apt-get", [
    "install",
    "-y",
    "build-essential",
    "ca-certificates",
    "gnupg",
  ]);

  const tempDir = mkdtempSync(join(tmpdir(), "incantation-ultraleap-apt-"));
  try {
    const response = await fetch(keyUrl);
    if (!response.ok) {
      fail(
        `Unable to download Ultraleap apt key from ${keyUrl}. See docs/ultraleap-linux-runtime.md for the private-cache recovery workflow.`,
      );
    }

    const armoredKeyPath = join(tempDir, "ultraleap.asc");
    const gpgPath = join(tempDir, "ultraleap.gpg");
    const listPath = join(tempDir, "ultraleap.list");
    writeFileSync(armoredKeyPath, await response.text(), "utf8");
    run("gpg", ["--dearmor", "--yes", "--output", gpgPath, armoredKeyPath]);
    writeFileSync(listPath, repoLine, "utf8");

    runAsRoot("cp", [gpgPath, "/etc/apt/trusted.gpg.d/ultraleap.gpg"]);
    runAsRoot("cp", [listPath, "/etc/apt/sources.list.d/ultraleap.list"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  runAsRoot("apt-get", ["update"]);
  runAsRoot("apt-get", ["install", "-y", "ultraleap-hand-tracking"]);
  verifyRuntimeFiles();
};

const verifyPythonBindings = () => {
  console.log("Verifying Python 'leap' bindings inside apps/vision-service...");
  ensureVisionServiceEnv();
  run(visionPython, [
    "-c",
    ["import leap", "print('leap import ok')", "print(leap.__file__)"].join(
      "; ",
    ),
  ]);
};

const compilerEnv = (): NodeJS.ProcessEnv => {
  return {
    ...process.env,
    CC: process.env.CC ?? "gcc",
    CXX: process.env.CXX ?? "g++",
  };
};

const ensureCompiler = () => {
  if (!commandExists(process.env.CC ?? "gcc")) {
    fail(
      "A C compiler is required for the Leap bindings build. Install build-essential or rerun bun run setup:leap.",
    );
  }
};

const ensureVisionServiceEnv = () => {
  run("uv", ["sync", "--directory", visionServiceArg, "--inexact"]);

  if (!existsSync(visionPython)) {
    fail(`Expected uv environment python at ${visionPython}.`);
  }
};

const installPythonBindings = () => {
  console.log("Installing Leap Python bindings into apps/vision-service...");
  verifyRuntimeFiles();
  ensureVisionServiceEnv();
  ensureCompiler();

  const tempDir = mkdtempSync(join(tmpdir(), "incantation-leap-bindings-"));
  const repoDir = join(tempDir, "leapc-python-bindings");
  try {
    run("git", ["clone", "--depth", "1", bindingsRepo, repoDir]);
    run("uv", [
      "pip",
      "install",
      "--python",
      visionPython,
      "--upgrade",
      "build",
      "cffi",
      "setuptools",
      "wheel",
    ]);
    run(
      "uv",
      [
        "run",
        "--directory",
        visionServiceArg,
        "python",
        "-m",
        "build",
        "--sdist",
        "--no-isolation",
        join(repoDir, "leapc-cffi"),
      ],
      { env: compilerEnv() },
    );

    const distDir = join(repoDir, "leapc-cffi", "dist");
    const sdist = readdirSync(distDir)
      .filter((entry) => entry.endsWith(".tar.gz"))
      .sort()
      .at(-1);
    if (!sdist) {
      fail(`No leapc_cffi source distribution found in ${distDir}.`);
    }

    run(
      "uv",
      [
        "pip",
        "install",
        "--python",
        visionPython,
        "--reinstall",
        join(distDir, sdist),
      ],
      { env: compilerEnv() },
    );
    run("uv", [
      "pip",
      "install",
      "--python",
      visionPython,
      "--reinstall",
      "--no-deps",
      join(repoDir, "leapc-python-api"),
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  verifyPythonBindings();
};

const main = async () => {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  requireLinuxAmd64();

  ensureVisionServiceEnv();

  if (!options.skipSystem && !options.verifyOnly) {
    await installUltraleapRuntime();
  }

  if (!options.skipBindings && !options.verifyOnly) {
    installPythonBindings();
  }

  verifyRuntimeFiles();
  verifyPythonBindings();
  console.log("Leap setup complete.");
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
