import { cliEnvironment } from "./supabase-env.mjs";
import { execFileSync } from "node:child_process";
export function localConfig() {
  let raw;
  try {
    raw = execFileSync("node_modules/.bin/supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      env: cliEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "Local Supabase is unavailable. Start it with npm run db:start; CLI output is withheld to protect credentials.",
    );
  }
  const config = JSON.parse(raw.slice(raw.indexOf("{")));
  if (
    !config.API_URL?.startsWith("http://127.0.0.1:") ||
    !config.DB_URL?.includes("127.0.0.1")
  )
    throw new Error(
      "Local-only verification requires a running local Supabase.",
    );
  return config;
}
