import { runApp } from "./app/App.js";

runApp().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
