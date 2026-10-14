import { spawn } from "node:child_process";
import { cliEnvironment } from "./supabase-env.mjs";
const child = spawn("node_modules/.bin/supabase", process.argv.slice(2), {
  stdio: "inherit",
  env: cliEnvironment,
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
