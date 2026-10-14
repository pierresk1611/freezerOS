import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { localConfig } from "./local-env.mjs";
const config = localConfig();
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const ids = [];
let checks = 0;
const check = (x, label) => {
  assert.ok(x, label);
  console.log("PASS " + label);
  checks++;
};
async function user() {
  const email = `cubes-${randomUUID()}@freezer.test`,
    password = randomUUID() + "aA1!";
  const r = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (r.error) throw r.error;
  ids.push(r.data.user.id);
  const client = createClient(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password });
  return { client, id: r.data.user.id };
}
try {
  const a = await user(),
    b = await user();
  const old = JSON.parse(readFileSync("docs/seed-recipes.json"));
  const seed = JSON.parse(readFileSync("docs/pulled-recipes.json"));
  let r = await a.client.rpc("import_recipes", {
    p_import_id: old.importId,
    p_recipes: old.payload,
  });
  check(!r.error, "original fifteen templates import");
  const before = await a.client.from("recipe_versions").select("*");
  r = await a.client.rpc("import_recipes", {
    p_import_id: seed.importId,
    p_recipes: seed.payload,
  });
  check(!r.error, "four pulled templates import");
  r = await a.client.rpc("import_recipes", {
    p_import_id: seed.importId,
    p_recipes: seed.payload,
  });
  check(!r.error, "pulled import is idempotent");
  const recipes = await a.client.from("recipe_latest").select("*");
  check(recipes.data.length === 19, "no duplicated templates");
  for (const v of before.data) {
    const current = recipes.data.find((x) => x.id === v.id);
    assert.deepEqual(current, v);
  }
  check(true, "original recipes and IDs preserved");
  const recipe = recipes.data.find((x) => x.name === seed.payload[0].name);
  check(
    recipe.metadata.category === "slow_roasted_pulled_meat" &&
      recipe.metadata.oven_c === 150,
    "cooking metadata stored",
  );
  const molds = await a.client
    .from("portion_molds")
    .insert([
      { user_id: a.id, name: "250 ml", cells: 4, cell_ml: 250, owned_count: 1 },
      { user_id: a.id, name: "500 ml", cells: 2, cell_ml: 500, owned_count: 1 },
    ])
    .select("*");
  check(!molds.error, "explicit ownership of two molds");
  check(
    (await b.client.from("portion_molds").select("*")).data.length === 0,
    "mold RLS",
  );
  const small = molds.data.find((m) => m.cell_ml === 250).id,
    large = molds.data.find((m) => m.cell_ml === 500).id;
  const cubes = [
    { mold_id: small, weight_g: 200, volume_ml: 250 },
    { mold_id: small, weight_g: 200, volume_ml: 250 },
    { mold_id: small, weight_g: 100, volume_ml: 125 },
    { mold_id: large, weight_g: 400, volume_ml: 450 },
    { mold_id: large, weight_g: 300, volume_ml: 300 },
  ];
  const repeatedMold = await a.client
    .from("portion_molds")
    .upsert(
      { user_id: a.id, name: "250 ml", cells: 4, cell_ml: 250, owned_count: 1 },
      { onConflict: "user_id,name,cells,cell_ml" },
    );
  check(
    !repeatedMold.error &&
      (await a.client.from("portion_molds").select("*")).data.length === 2,
    "mold ownership confirmation does not duplicate physical types",
  );
  const batch = randomUUID();
  const args = {
    p_id: batch,
    p_version: recipe.id,
    p_weight: 1200,
    p_cost: 12001,
    p_made: "2026-10-14",
    p_quality: "2026-12-01",
    p_cubes: cubes,
  };
  check(
    Boolean(
      (await b.client.rpc("start_cube_batch", { ...args, p_id: randomUUID() }))
        .error,
    ),
    "foreign recipe or molds rejected",
  );
  check(
    Boolean(
      (
        await a.client.rpc("start_cube_batch", {
          ...args,
          p_id: randomUUID(),
          p_weight: 1500,
        })
      ).error,
    ),
    "mismatched measured yield rolls back",
  );
  check(
    (await a.client.from("cooking_batches").select("*")).data.length === 0,
    "invalid cube batch leaves no artifacts",
  );
  r = await a.client.rpc("start_cube_batch", args);
  check(!r.error, "1200 g actual yield with different cube volumes");
  r = await a.client.rpc("start_cube_batch", args);
  check(!r.error, "idempotent preparation");
  check(
    (await a.client.from("cooking_batches").select("*")).data.length === 1,
    "one cooking batch",
  );
  check(
    (await a.client.from("inventory_packages").select("*")).data.length === 0,
    "no stock before vacuum packaging",
  );
  const cubeRows = await a.client
    .from("batch_cubes")
    .select("*")
    .eq("batch_id", batch);
  check(
    cubeRows.data.length === 5 &&
      cubeRows.data.reduce((s, c) => s + c.weight_g, 0) === 1200,
    "five cubes keep actual mass",
  );
  check(
    (await b.client.from("batch_cubes").select("*")).data.length === 0,
    "cube RLS isolation",
  );
  check(
    Boolean(
      (
        await a.client
          .from("portion_molds")
          .update({ cells: 1 })
          .eq("id", large)
      ).error,
    ),
    "owned capacity cannot shrink below active cubes",
  );
  check(
    Boolean(
      (await a.client.rpc("start_cube_batch", { ...args, p_id: randomUUID() }))
        .error,
    ),
    "occupied mold capacity cannot be reused",
  );
  const packs = [
    { cubes: [0, 1], portions: 1, location_id: null },
    { cubes: [2, 3], portions: 1.5, location_id: null },
    { cubes: [4], portions: 0.5, location_id: null },
  ];
  check(
    Boolean(
      (
        await a.client.rpc("pack_cube_batch", {
          p_batch: batch,
          p_request: randomUUID(),
          p_packages: packs,
        })
      ).error,
    ),
    "packing before freezing rejected",
  );
  const frozen = randomUUID();
  r = await a.client.rpc("freeze_cube_batch", {
    p_batch: batch,
    p_request: frozen,
    p_frozen: "2026-10-15",
  });
  check(!r.error, "confirm frozen cubes");
  r = await a.client.rpc("freeze_cube_batch", {
    p_batch: batch,
    p_request: frozen,
    p_frozen: "2026-10-15",
  });
  check(!r.error, "freezing replay idempotent");
  check(
    Boolean(
      (
        await b.client.rpc("pack_cube_batch", {
          p_batch: batch,
          p_request: randomUUID(),
          p_packages: packs,
        })
      ).error,
    ),
    "foreign batch packing rejected",
  );
  check(
    Boolean(
      (
        await a.client.rpc("pack_cube_batch", {
          p_batch: batch,
          p_request: randomUUID(),
          p_packages: [packs[0], { ...packs[1], cubes: [1, 2, 3] }, packs[2]],
        })
      ).error,
    ),
    "duplicate cube rejected",
  );
  check(
    Boolean(
      (
        await a.client.rpc("pack_cube_batch", {
          p_batch: batch,
          p_request: randomUUID(),
          p_packages: packs.slice(0, 2),
        })
      ).error,
    ),
    "missing cube rolls back stock",
  );
  check(
    (await a.client.from("inventory_packages").select("*")).data.length === 0,
    "failed packaging atomic",
  );
  const requestIds = [randomUUID(), randomUUID()];
  const races = await Promise.all(
    requestIds.map((p_request) =>
      a.client.rpc("pack_cube_batch", {
        p_batch: batch,
        p_request,
        p_packages: packs,
      }),
    ),
  );
  check(
    races.filter((x) => !x.error).length === 1,
    "concurrent final packaging serializes",
  );
  const success = requestIds[races.findIndex((x) => !x.error)];
  r = await a.client.rpc("pack_cube_batch", {
    p_batch: batch,
    p_request: success,
    p_packages: packs,
  });
  check(!r.error, "packing replay does not receive stock twice");
  const packages = await a.client
    .from("inventory_packages")
    .select("*")
    .eq("batch_id", batch);
  check(packages.data.length === 3, "three final bags");
  check(
    packages.data.reduce((s, p) => s + p.initial_g, 0) === 1200 &&
      packages.data.reduce((s, p) => s + Number(p.cost_minor), 0) === 12001,
    "mass and exact financial balance",
  );
  check(
    packages.data
      .map((p) => p.initial_g)
      .sort()
      .join(",") === "300,400,500",
    "unequal package weights",
  );
  check(
    packages.data.reduce((s, p) => s + p.cube_count, 0) === 5,
    "cube counts conserved",
  );
  check(
    packages.data.reduce((s, p) => s + Number(p.portions), 0) === 3,
    "actual portion count",
  );
  check(
    new Set(packages.data.map((p) => p.id)).size === 3,
    "unique QR identifiers",
  );
  check(
    (await a.client.from("inventory_movements").select("*")).data.length === 3,
    "exactly three stock receipts",
  );
  const pkg = packages.data.find((p) => p.initial_g === 400);
  r = await a.client.rpc("consume_package", {
    p_package_id: pkg.id,
    p_request_id: randomUUID(),
    p_grams: 200,
  });
  check(!r.error, "partial portion consumption");
  const remaining = await a.client
    .from("inventory_packages")
    .select("*")
    .eq("batch_id", batch);
  check(
    remaining.data.reduce((s, p) => s + p.remaining_g, 0) === 1000,
    "remaining stock decreases once",
  );
  const history = await a.client.from("meal_logs").select("*");
  check(
    Number(history.data[0].cost_minor) === 2000,
    "historical consumed food cost",
  );
  check(
    (
      await a.client
        .from("cooking_batches")
        .select("*")
        .eq("id", batch)
        .single()
    ).data.cost_minor === 12001,
    "batch cost snapshot unchanged",
  );
  const pref = await a.client.from("food_preferences").insert({
    user_id: a.id,
    favorites: ["Trhané bravčové"],
    combinations: ["Trhané mäso + kukurica"],
  });
  check(!pref.error, "editable soft preferences stored");
  check(
    (await b.client.from("food_preferences").select("*")).data.length === 0,
    "preference RLS",
  );
  const plan = await a.client.from("meal_plan_entries").insert({
    user_id: a.id,
    recipe_version_id: recipe.id,
    meal_date: "2026-10-14",
    slot: "dinner",
    portions: 1,
  });
  check(!plan.error, "meal planning records portions");
  check(
    Boolean(
      (
        await b.client.from("meal_plan_entries").insert({
          user_id: b.id,
          recipe_version_id: recipe.id,
          meal_date: "2026-10-14",
          slot: "dinner",
          portions: 1,
        })
      ).error,
    ),
    "planner rejects foreign recipes",
  );
  check(
    (
      await a.client
        .from("inventory_packages")
        .select("*")
        .eq("batch_id", batch)
    ).data.reduce((s, p) => s + p.remaining_g, 0) === 1000,
    "planning never consumes stock",
  );
  const revision = randomUUID();
  r = await a.client.rpc("revise_recipe", {
    p_version_id: recipe.id,
    p_request_id: revision,
    p_recipe: { ...seed.payload[0], oven_c: 155 },
  });
  check(!r.error, "metadata creates a new cooking version");
  check(
    (
      await a.client
        .from("recipe_versions")
        .select("*")
        .eq("id", recipe.id)
        .single()
    ).data.metadata.oven_c === 150,
    "historical temperature preserved",
  );
  check(
    (
      await a.client
        .from("cooking_batches")
        .select("*")
        .eq("id", batch)
        .single()
    ).data.recipe_version_id === recipe.id,
    "batch retains recipe snapshot",
  );
  const unknown = randomUUID();
  let operation = await a.client.rpc("start_cube_batch", {
    ...args,
    p_id: unknown,
    p_weight: 80,
    p_cost: null,
    p_cubes: [{ mold_id: small, weight_g: 80, volume_ml: 125 }],
  });
  check(!operation.error, "freed molds can be reused");
  operation = await a.client.rpc("freeze_cube_batch", {
    p_batch: unknown,
    p_request: randomUUID(),
    p_frozen: "2026-10-15",
  });
  assert.ok(!operation.error);
  operation = await a.client.rpc("pack_cube_batch", {
    p_batch: unknown,
    p_request: randomUUID(),
    p_packages: [{ cubes: [0], portions: 1, location_id: null }],
  });
  check(
    !operation.error &&
      (
        await a.client
          .from("inventory_packages")
          .select("*")
          .eq("batch_id", unknown)
          .single()
      ).data.cost_minor === null,
    "unknown batch cost remains unknown after packing",
  );
  operation = await a.client.rpc("create_batch", {
    p_version_id: recipe.id,
    p_request_id: randomUUID(),
    p_weight_g: 90,
    p_package_count: 1,
    p_cost_minor: null,
    p_best_before: "2026-12-01",
  });
  assert.ok(!operation.error);
  const legacy = (
    await a.client
      .from("cooking_batches")
      .select("*")
      .eq("weight_g", 90)
      .single()
  ).data;
  check(
    legacy.portion_status === "legacy",
    "old batch workflow remains available",
  );
  operation = await a.client.rpc("pack_cube_batch", {
    p_batch: legacy.id,
    p_request: randomUUID(),
    p_packages: [{ cubes: [0], portions: 1, location_id: null }],
  });
  check(
    Boolean(operation.error) &&
      (
        await a.client
          .from("inventory_packages")
          .select("*")
          .eq("batch_id", legacy.id)
      ).data.length === 1,
    "legacy inventory cannot be received again",
  );
  console.log(`${checks} pulled-meat and cubes checks passed.`);
} finally {
  for (const id of ids) {
    const deleted = await admin.auth.admin.deleteUser(id);
    if (deleted.error) throw deleted.error;
  }
}
