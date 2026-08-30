import { spawn } from "node:child_process";

const required = [26, 4];
const actual = process.versions.node.split(".").map(Number);

if (actual[0] < required[0] || (actual[0] === required[0] && actual[1] < required[1])) {
  console.error(
    `Codepanes requires Node.js ${required[0]}.${required[1]} or later; found Node.js ${process.versions.node}.`,
  );
  console.error("Install a supported Node.js version, then run `npm run dev` again.");
  process.exit(1);
}

const child = spawn(process.execPath, [
  "--experimental-ffi",
  "dist/main.js",
], {
  stdio: "inherit",
});

let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
