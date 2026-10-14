import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localConfig } from "./local-env.mjs";
const config = localConfig();
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const users = [];
let checks = 0;
function check(condition, label) {
  assert.ok(condition, label);
  checks++;
  console.log("PASS " + label);
}
async function makeUser() {
  const email = `test-${randomUUID()}@freezer.test`,
    password = randomUUID() + "aA1!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  users.push(data.user.id);
  const client = createClient(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false },
  });
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) throw result.error;
  return client;
}
const sql = new pg.Client({ connectionString: config.DB_URL });
await sql.connect();
try {
  const a = await makeUser(),
    b = await makeUser();
  const recipe = {
    name: "Testovací guláš",
    portions: 2,
    ingredients: [{ name: "Mäso", quantity: 700, unit: "g" }],
    steps: ["Dusiť."],
    reheating: "Dôkladne prehriať.",
  };
  const importId = randomUUID();
  let result = await a.rpc("import_recipes", {
    p_import_id: importId,
    p_recipes: [recipe],
  });
  check(!result.error, "recipe import");
  result = await a.rpc("import_recipes", {
    p_import_id: importId,
    p_recipes: [recipe],
  });
  check(!result.error, "idempotent import replay");
  const versions = await a.from("recipe_versions").select("*");
  check(versions.data?.length === 1, "one immutable recipe version");
  const foreign = await b.from("recipe_versions").select("*");
  check(foreign.data?.length === 0, "RLS isolates users");
  result = await b.rpc("create_batch", {
    p_version_id: versions.data[0].id,
    p_request_id: randomUUID(),
    p_weight_g: 1500,
    p_package_count: 2,
    p_cost_minor: 27801,
    p_best_before: "2027-01-01",
  });
  check(Boolean(result.error), "RPC rejects foreign recipe");
  const batchRequest = randomUUID();
  const batch = {
    p_version_id: versions.data[0].id,
    p_request_id: batchRequest,
    p_weight_g: 1500,
    p_package_count: 2,
    p_cost_minor: 27801,
    p_best_before: "2027-01-01",
  };
  result = await a.rpc("create_batch", batch);
  check(!result.error, "batch and inventory receipt");
  await a.rpc("create_batch", batch);
  const packages = await a.from("inventory_packages").select("*");
  check(packages.data?.length === 2, "idempotent batch");
  check(
    packages.data.reduce((sum, p) => sum + p.cost_minor, 0) === 27801,
    "cost allocation conserves minor units",
  );
  const first = packages.data[0];
  const direct = await a
    .from("inventory_packages")
    .update({ remaining_g: -1 })
    .eq("id", first.id);
  check(Boolean(direct.error), "direct stock mutation denied");
  const request = randomUUID();
  result = await a.rpc("consume_package", {
    p_package_id: first.id,
    p_request_id: request,
    p_grams: 250,
  });
  check(!result.error, "partial consumption");
  await a.rpc("consume_package", {
    p_package_id: first.id,
    p_request_id: request,
    p_grams: 250,
  });
  const after = await a
    .from("inventory_packages")
    .select("*")
    .eq("id", first.id)
    .single();
  check(
    after.data.remaining_g === 500,
    "duplicate consumption does not deduct twice",
  );
  result = await a.rpc("consume_package", {
    p_package_id: first.id,
    p_request_id: request,
    p_grams: 251,
  });
  check(Boolean(result.error), "request ID cannot change payload");
  const concurrent = await Promise.all([
    a.rpc("consume_package", {
      p_package_id: first.id,
      p_request_id: randomUUID(),
      p_grams: 400,
    }),
    a.rpc("consume_package", {
      p_package_id: first.id,
      p_request_id: randomUUID(),
      p_grams: 400,
    }),
  ]);
  check(
    concurrent.filter((r) => !r.error).length === 1,
    "concurrent stock deductions serialize",
  );
  const remainder = await a
    .from("inventory_packages")
    .select("*")
    .eq("id", first.id)
    .single();
  check(remainder.data.remaining_g === 100, "stock never becomes negative");
  result = await a.rpc("consume_package", {
    p_package_id: first.id,
    p_request_id: randomUUID(),
    p_grams: 100,
  });
  check(!result.error, "last partial consumption");
  const logs = await a.from("meal_logs").select("*").eq("package_id", first.id);
  check(
    logs.data.reduce((s, l) => s + l.cost_minor, 0) === first.cost_minor,
    "historical consumption costs conserve allocation",
  );
  const {
    data: { user },
  } = await a.auth.getUser();
  const location = await a
    .from("storage_locations")
    .insert({ user_id: user.id, name: "Zásuvka 2" })
    .select()
    .single();
  check(!location.error, "location creation");
  result = await a.rpc("move_package", {
    p_package_id: packages.data[1].id,
    p_request_id: randomUUID(),
    p_location_id: location.data.id,
  });
  check(!result.error, "audited package movement");
  const moved = await a
    .from("inventory_packages")
    .select("*")
    .eq("id", packages.data[1].id)
    .single();
  check(
    moved.data.location_id === location.data.id,
    "movement updates location",
  );
  result = await b.rpc("consume_package", {
    p_package_id: packages.data[1].id,
    p_request_id: randomUUID(),
    p_grams: 1,
  });
  check(Boolean(result.error), "cross-user consumption denied");
  result = await a.rpc("revise_recipe", {
    p_version_id: versions.data[0].id,
    p_request_id: randomUUID(),
    p_recipe: { ...recipe, name: "Nový názov" },
  });
  check(!result.error, "recipe revision");
  const history = await a
    .from("recipe_versions")
    .select("*")
    .eq("id", versions.data[0].id)
    .single();
  check(
    history.data.name === recipe.name,
    "historical recipe version unchanged",
  );
  result = await a.rpc("revise_recipe", {
    p_version_id: versions.data[0].id,
    p_request_id: randomUUID(),
    p_recipe: recipe,
  });
  check(Boolean(result.error), "stale recipe editing rejected");
  const latest = await a.from("recipe_latest").select("*");
  check(
    latest.data.length === 1 && latest.data[0].version === 2,
    "latest recipe view",
  );
  result = await a.rpc("archive_recipe", {
    p_recipe_id: versions.data[0].recipe_id,
    p_request_id: randomUUID(),
  });
  check(!result.error, "archive recipe");
  const archived = await a.from("recipe_latest").select("*");
  check(
    archived.data.length === 0,
    "archived recipe excluded from active list",
  );
  const originalBatch = await a.from("cooking_batches").select("*").single();
  check(
    originalBatch.data.cost_minor === 27801 &&
      originalBatch.data.recipe_version_id === versions.data[0].id,
    "historical batch keeps original cost and version",
  );
  const count = await sql.query(
    "select count(*)::int n from public.inventory_movements where user_id=$1",
    [user.id],
  );
  check(count.rows[0].n === 6, "ledger records only committed operations");
  const anon = createClient(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false },
  });
  result = await anon.rpc("import_recipes", {
    p_import_id: randomUUID(),
    p_recipes: [recipe],
  });
  check(Boolean(result.error), "anonymous RPC denied");
  console.log(`${checks} database integration checks passed.`);
} finally {
  for (const id of users) {
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) throw result.error;
  }
  await sql.end();
}
