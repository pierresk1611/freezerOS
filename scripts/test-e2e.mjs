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
let legacyUser = null;
const legacyEmail = `legacy-e2e-${randomUUID()}@freezer.test`,
  legacyPassword = randomUUID() + "Aa1!";
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
  const old = await admin.auth.admin.createUser({
    email: legacyEmail,
    password: legacyPassword,
    email_confirm: true,
  });
  if (old.error) throw old.error;
  legacyUser = old.data.user.id;
  const legacy = createClient(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false },
  });
  await legacy.auth.signInWithPassword({
    email: legacyEmail,
    password: legacyPassword,
  });
  const pulled = JSON.parse(readFileSync("docs/pulled-recipes.json", "utf8"));
  const seeded = await legacy.rpc("import_recipes", {
    p_import_id: pulled.importId,
    p_recipes: pulled.payload,
  });
  if (seeded.error) throw seeded.error;
  const first = (
    await legacy
      .from("recipe_versions")
      .select("*")
      .eq("name", pulled.payload[0].name)
      .single()
  ).data;
  const revised = await legacy.rpc("revise_recipe", {
    p_version_id: first.id,
    p_request_id: randomUUID(),
    p_recipe: {
      ...pulled.payload[0],
      name: "Moje upravené trhané bravčové",
      steps: ["Používateľský postup zachovať."],
    },
  });
  if (revised.error) throw revised.error;
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
        FREEZER_LEGACY_EMAIL: legacyEmail,
        FREEZER_LEGACY_PASSWORD: legacyPassword,
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
  if (legacyUser) {
    const deleted = await admin.auth.admin.deleteUser(legacyUser);
    if (deleted.error) throw deleted.error;
  }
  const result = await admin.auth.admin.deleteUser(data.user.id);
  if (result.error) throw result.error;
}
