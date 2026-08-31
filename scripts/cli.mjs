#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, ["--experimental-ffi", path.join(packageRoot, "dist", "main.js"), ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: process.cwd(),
});

let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(`Unable to start CodePanes: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
