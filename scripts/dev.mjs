import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourceDirectory = path.join(root, "src");
let app = null;
let restartTimer = null;
let restarting = false;
let shuttingDown = false;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) resolve(1);
      else resolve(code ?? 1);
    });
  });
}

async function stopApp() {
  if (!app) return;
  const child = app;
  app = null;

  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      finished = true;
      resolve();
    };
    child.once("exit", finish);
    child.kill("SIGTERM");
    const forceExit = setTimeout(() => {
      if (!finished) child.kill("SIGKILL");
      resolve();
    }, 2000);
    forceExit.unref();
  });
}

async function startApp() {
  if (shuttingDown) return;
  const buildCode = await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
  if (buildCode !== 0 || shuttingDown) return;

  app = spawn(process.execPath, ["scripts/run.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  app.once("exit", () => {
    app = null;
  });
}

function scheduleRestart() {
  if (shuttingDown) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    if (restarting || shuttingDown) return;
    restarting = true;
    await stopApp();
    await startApp();
    restarting = false;
  }, 100);
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  watcher.close();
  await stopApp();
  process.exit(signal ? 128 + (signal === "SIGINT" ? 2 : 15) : 0);
}

const watcher = watch(sourceDirectory, { recursive: true }, (_event, filename) => {
  if (filename?.endsWith(".ts")) scheduleRestart();
});

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await startApp();
