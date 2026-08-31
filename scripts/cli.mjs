#!/usr/bin/env node

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const minimumNode = [26, 4];

function nodeVersion(nodePath) {
  try {
    const version = execFileSync(nodePath, ["--version"], { encoding: "utf8" }).trim();
    const match = /^v(\d+)\.(\d+)\./.exec(version);
    if (!match) return null;
    return { path: nodePath, major: Number(match[1]), minor: Number(match[2]), version };
  } catch {
    return null;
  }
}

function addPathCandidate(candidates, nodePath) {
  if (nodePath && existsSync(nodePath) && !candidates.includes(nodePath)) candidates.push(nodePath);
}

function runtimeCandidates() {
  const candidates = [process.execPath];
  const executable = process.platform === "win32" ? "node.exe" : "node";
  if (process.env.NVM_BIN) addPathCandidate(candidates, path.join(process.env.NVM_BIN, executable));
  const nvmVersions = path.join(process.env.NVM_DIR ?? path.join(process.env.HOME ?? "", ".nvm"), "versions", "node");
  if (existsSync(nvmVersions)) {
    for (const version of readdirSync(nvmVersions)) {
      if (version.startsWith("v26.")) addPathCandidate(candidates, path.join(nvmVersions, version, "bin", executable));
    }
  }
  for (const command of process.platform === "win32" ? ["node26.exe", "node-26.exe"] : ["node26", "node-26"]) {
    try {
      const output = execFileSync(process.platform === "win32" ? "where.exe" : "which", [command], { encoding: "utf8" });
      addPathCandidate(candidates, output.split(/\r?\n/)[0]);
    } catch {
      // The command is optional; continue looking for another installed runtime.
    }
  }
  const asdfRoot = path.join(process.env.HOME ?? "", ".asdf", "installs", "nodejs");
  if (existsSync(asdfRoot)) {
    for (const version of readdirSync(asdfRoot)) {
      if (version.startsWith("26.")) addPathCandidate(candidates, path.join(asdfRoot, version, "bin", executable));
    }
  }
  return candidates;
}

const runtime = runtimeCandidates()
  .map(nodeVersion)
  .find((candidate) => candidate && candidate.major === minimumNode[0] && candidate.minor >= minimumNode[1]);

if (!runtime) {
  console.error("CodePanes requires Node.js 26.4 or newer.");
  console.error("Install Node.js 26.4+ alongside your current Node.js version; your default Node environment will not be changed.");
  process.exit(1);
}

const child = spawn(runtime.path, ["--experimental-ffi", path.join(packageRoot, "dist", "main.js"), ...process.argv.slice(2)], {
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
