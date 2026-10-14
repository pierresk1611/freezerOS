import { spawn } from "node:child_process";
import { localConfig } from "./local-env.mjs";
const config = localConfig();
const server = spawn(
  "node_modules/.bin/next",
  ["dev", "--hostname", "0.0.0.0"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: config.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY,
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.kill(signal));
server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
