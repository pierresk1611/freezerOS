import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { localConfig } from "./local-env.mjs";
const config = localConfig();
const email = `e2e-${randomUUID()}@freezer.test`,
  password = randomUUID() + "aA1!";
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (error) throw error;
try {
  const result = spawnSync("node_modules/.bin/playwright", ["test"], {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: config.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY,
      FREEZER_TEST_EMAIL: email,
      FREEZER_TEST_PASSWORD: password,
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  const result = await admin.auth.admin.deleteUser(data.user.id);
  if (result.error) throw result.error;
}
