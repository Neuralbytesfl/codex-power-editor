import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

export function planForFile(filePath, executablePath = "program") {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".py") {
    return { language: "Python", compile: null, run: { command: "python3", args: [filePath] } };
  }
  if (extension === ".c") {
    return {
      language: "C",
      compile: { command: "gcc", args: [filePath, "-Wall", "-Wextra", "-o", executablePath] },
      run: { command: executablePath, args: [] }
    };
  }
  if ([".cc", ".cpp", ".cxx"].includes(extension)) {
    return {
      language: "C++",
      compile: { command: "g++", args: [filePath, "-Wall", "-Wextra", "-std=c++17", "-o", executablePath] },
      run: { command: executablePath, args: [] }
    };
  }
  if ([".js", ".mjs", ".cjs"].includes(extension)) {
    return { language: "JavaScript", compile: null, run: { command: "node", args: [filePath] } };
  }
  if (extension === ".sh") {
    return { language: "Shell", compile: null, run: { command: "bash", args: [filePath] } };
  }
  if (extension === ".rb") {
    return { language: "Ruby", compile: null, run: { command: "ruby", args: [filePath] } };
  }
  if (extension === ".rs") {
    return { language: "Rust", compile: { command: "rustc", args: [filePath, "-o", executablePath] }, run: { command: executablePath, args: [] } };
  }
  return null;
}

function execute(command, args, { cwd, signal, onOutput }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    child.once("error", error => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code, closeSignal) => {
      signal?.removeEventListener("abort", abort);
      resolve({ code: code ?? 1, signal: closeSignal });
    });
  });
}

export async function runSource({ filePath, signal, onOutput, onStage }) {
  const buildDir = await mkdtemp(join(tmpdir(), "cpx-run-"));
  const executable = join(buildDir, process.platform === "win32" ? "program.exe" : "program");
  const plan = planForFile(filePath, executable);
  if (!plan) {
    await rm(buildDir, { recursive: true, force: true });
    throw new Error(`Running ${extname(filePath) || "extensionless files"} is not supported yet`);
  }

  const cwd = dirname(filePath);
  try {
    if (plan.compile) {
      onStage?.(`Compiling ${basename(filePath)} with ${plan.compile.command}…`);
      const compiled = await execute(plan.compile.command, plan.compile.args, { cwd, signal, onOutput });
      if (signal?.aborted) return { language: plan.language, code: 130, cancelled: true };
      if (compiled.code !== 0) return { language: plan.language, code: compiled.code, compileFailed: true };
    }
    onStage?.(`Running ${basename(filePath)}…`);
    const result = await execute(plan.run.command, plan.run.args, { cwd, signal, onOutput });
    return { language: plan.language, code: signal?.aborted ? 130 : result.code, cancelled: signal?.aborted };
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
}
