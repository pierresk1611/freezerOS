import { resolve } from "node:path";
export const cliEnvironment = {
  ...process.env,
  SUPABASE_HOME: process.env.SUPABASE_HOME ?? resolve(".local/supabase"),
  SUPABASE_TELEMETRY_DISABLED: "true",
};
