import { readFileSync } from "node:fs";
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
  const fixture = createClient(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false },
  });
  const signed = await fixture.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error("Fixture sign-in failed");
  const corrections = JSON.parse(
    readFileSync("docs/seed-corrections/storage-reheating-v1.json", "utf8"),
  );
  const seed = JSON.parse(readFileSync("docs/seed-recipes.json", "utf8"));
  const imported = await fixture.rpc("import_recipes", {
    p_import_id: seed.importId,
    p_recipes: corrections.items.map((item) => item.before),
  });
  if (imported.error) throw new Error("Legacy recipe fixture import failed");
  const result = spawnSync(
    "node_modules/.bin/playwright",
    ["test", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: config.API_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY,
        FREEZER_TEST_API_URL: config.API_URL,
        FREEZER_TEST_ANON_KEY: config.ANON_KEY,
        FREEZER_TEST_EMAIL: email,
        FREEZER_TEST_PASSWORD: password,
      },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  async function removeFixtureFiles(prefix, bucket) {
    const listing = await admin.storage
      .from(bucket)
      .list(prefix, { limit: 1000 });
    if (listing.error) throw listing.error;
    for (const item of listing.data ?? []) {
      const path = prefix + "/" + item.name;
      if (!item.id) await removeFixtureFiles(path, bucket);
      else {
        const removed = await admin.storage.from(bucket).remove([path]);
        if (removed.error) throw removed.error;
      }
    }
  }
  await removeFixtureFiles(data.user.id, "recipe-photos");
  await removeFixtureFiles(data.user.id, "purchase-receipts");
  const result = await admin.auth.admin.deleteUser(data.user.id);
  if (result.error) throw result.error;
}
