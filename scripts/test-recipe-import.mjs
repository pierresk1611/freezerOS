import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { localConfig } from "./local-env.mjs";
const cfg = localConfig(),
  admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  }),
  users = [];
const sql = new pg.Client({ connectionString: cfg.DB_URL });
await sql.connect();
let count = 0;
const check = (v, m) => {
  assert.ok(v, m);
  count++;
  console.log("PASS " + m);
};
async function user() {
  const email = `batch-${randomUUID()}@freezer.test`,
    password = randomUUID() + "Aa1!";
  const r = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (r.error) throw r.error;
  users.push(r.data.user.id);
  const c = createClient(cfg.API_URL, cfg.ANON_KEY, {
    auth: { persistSession: false },
  });
  await c.auth.signInWithPassword({ email, password });
  return c;
}
const recipe = (n) => ({
  name: "Import test " + n,
  portions: 2,
  ingredients: [{ name: "Mäso", quantity: 500 + n, unit: "g" }],
  steps: ["Dusiť " + n],
  reheating: "Dôkladne ohriať.",
  storage: "Schladiť.",
  meat: "beef",
  freezing: true,
});
const call = (c, id, payload, index, mode = "new", target = null) =>
  c.rpc("import_recipe_item", {
    p_import_id: id,
    p_payload: payload,
    p_index: index,
    p_mode: mode,
    p_target: target,
  });
try {
  const a = await user(),
    b = await user(),
    id = randomUUID(),
    payload = Array.from({ length: 12 }, (_, n) => recipe(n));
  for (let n = 0; n < 12; n++)
    check(
      (await call(a, id, payload, n)).data?.status === "added",
      "add selected recipe " + (n + 1),
    );
  check(
    (await a.from("recipes").select("*")).data.length === 12,
    "exactly twelve new roots",
  );
  for (let n = 0; n < 12; n++)
    check(
      (await call(a, id, payload, n)).data?.reason === "already",
      "same file replay " + (n + 1),
    );
  check(
    (await a.from("recipe_versions").select("*")).data.length === 12,
    "repeated file creates no versions",
  );
  check(
    (await a.rpc("import_recipes", { p_import_id: id, p_recipes: payload }))
      .error === null,
    "legacy replay respects reserved full source",
  );
  check(
    (await a.from("recipes").select("*")).data.length === 12,
    "legacy replay cannot double partial/new import",
  );
  const changed = [{ ...payload[0], portions: 3 }, ...payload.slice(1)];
  check(
    (await call(a, id, changed, 0)).error?.message.includes("SOURCE_CHANGED"),
    "changed payload with same importId rejected",
  );
  check(
    (await b.from("recipe_import_items").select("*")).data.length === 0,
    "item ledger RLS",
  );
  check(
    (await b.from("recipe_import_sources").select("*")).data.length === 0,
    "source ledger RLS",
  );
  check(
    !!(
      await a.from("recipe_import_items").insert({
        user_id: users[0],
        import_id: id,
        item_index: 20,
        outcome: "added",
      })
    ).error,
    "direct ledger mutation denied",
  );
  const newer = randomUUID(),
    other = [recipe(99), { ...recipe(0), name: "Renamed same content" }];
  check(
    (await call(a, newer, other, 0)).data?.status === "added",
    "new independent source",
  );
  check(
    (await call(a, newer, other, 1)).data?.status === "duplicate",
    "renamed content duplicate skipped",
  );
  const first = (
    await a
      .from("recipe_versions")
      .select("*")
      .eq("name", recipe(0).name)
      .single()
  ).data;
  const batchRequest = randomUUID();
  check(
    !(
      await a.rpc("create_batch", {
        p_version_id: first.id,
        p_request_id: batchRequest,
        p_weight_g: 1000,
        p_package_count: 2,
        p_cost_minor: 12345,
        p_best_before: "2026-12-31",
      })
    ).error,
    "historical batch fixture",
  );
  const historical = (await a.from("cooking_batches").select("*").single())
    .data;
  const revised = [
      { ...recipe(0), steps: ["Nový používateľom potvrdený postup."] },
    ],
    revisionSource = randomUUID();
  const r = await call(a, revisionSource, revised, 0, "version", first.id);
  check(r.data?.status === "version", "explicit new version");
  check(
    (
      await a
        .from("recipe_versions")
        .select("*")
        .eq("recipe_id", first.recipe_id)
    ).data.length === 2,
    "old version remains immutable",
  );
  check(
    (await a.from("cooking_batches").select("*").single()).data
      .recipe_version_id === historical.recipe_version_id,
    "batch reference unchanged",
  );
  check(
    (await a.from("cooking_batches").select("*").single()).data.cost_minor ===
      12345,
    "historical food cost unchanged",
  );
  check(
    (await call(a, revisionSource, revised, 0, "version", first.id)).data
      ?.status === "skipped",
    "replayed version never duplicates",
  );
  check(
    !!(await call(b, randomUUID(), revised, 0, "version", r.data.versionId))
      .error,
    "cross-user target denied",
  );
  check(
    (
      await call(a, randomUUID(), revised, 0, "version", first.id)
    ).error?.message.includes("changed since editing"),
    "stale target refused",
  );
  const concurrent = await Promise.all([
    call(a, randomUUID(), [recipe(150)], 0),
    call(a, randomUUID(), [recipe(150)], 0),
  ]);
  check(
    concurrent.filter((x) => x.data?.status === "added").length === 1 &&
      concurrent.filter((x) => x.data?.status === "duplicate").length === 1,
    "simultaneous sources count identical recipe once",
  );
  const legacyId = randomUUID();
  await a.rpc("import_recipes", {
    p_import_id: legacyId,
    p_recipes: [recipe(201)],
  });
  const legacyVersion = (
    await a
      .from("recipe_versions")
      .select("*")
      .eq("name", recipe(201).name)
      .single()
  ).data;
  await a.rpc("revise_recipe", {
    p_version_id: legacyVersion.id,
    p_request_id: randomUUID(),
    p_recipe: {
      ...recipe(201),
      name: "User renamed legacy",
      steps: ["User changes preserved."],
    },
  });
  check(
    (await call(a, legacyId, [recipe(201)], 0)).data?.reason === "already",
    "legacy file remains processed after user edits",
  );
  check(
    (
      await a
        .from("recipe_versions")
        .select("*")
        .eq("recipe_id", legacyVersion.recipe_id)
    ).data.length === 2,
    "legacy replay preserves edited recipe",
  );
  const subset = randomUUID(),
    p = [recipe(210), recipe(211)];
  check(
    (await call(a, subset, p, 1)).data?.status === "added",
    "checkbox subset import",
  );
  check(
    (await a.from("recipe_versions").select("*").eq("name", recipe(210).name))
      .data.length === 0,
    "unchecked entry not imported",
  );
  check(
    (await call(a, subset, p, 0)).data?.status === "added",
    "later selection from same source works",
  );
  const archived = (
    await a
      .from("recipe_versions")
      .select("*")
      .eq("name", recipe(211).name)
      .single()
  ).data;
  await a.rpc("archive_recipe", {
    p_recipe_id: archived.recipe_id,
    p_request_id: randomUUID(),
  });
  check(
    (await call(a, randomUUID(), [recipe(211)], 0)).data?.status ===
      "duplicate",
    "archived recipes not silently recreated",
  );
  const invalidId = randomUUID();
  check(
    !!(await call(a, invalidId, [{ name: "invalid" }], 0)).error,
    "invalid recipe rejected",
  );
  check(
    (
      await a
        .from("recipe_import_sources")
        .select("*")
        .eq("import_id", invalidId)
    ).data.length === 0,
    "invalid first mutation rolls back reservation",
  );
  const oldMinimal = {
    name: "Old optional fields",
    portions: 2,
    ingredients: [{ name: "Mäso", quantity: 333, unit: "g" }],
    steps: ["Old source optional fields"],
    reheating: "Ohriať.",
  };
  const oldId = randomUUID();
  await a.rpc("import_recipes", {
    p_import_id: oldId,
    p_recipes: [oldMinimal],
  });
  check(
    (
      await call(
        a,
        oldId,
        [
          {
            ...oldMinimal,
            storage:
              "Rýchlo schlaďte. Rozmrazujte v chladničke a dôkladne prehrejte.",
            meat: "none",
            freezing: true,
          },
        ],
        0,
      )
    ).data?.reason === "already",
    "legacy default fields normalize without duplicate import",
  );
  const anonymous = createClient(cfg.API_URL, cfg.ANON_KEY, {
    auth: { persistSession: false },
  });
  check(
    !!(await call(anonymous, randomUUID(), [recipe(250)], 0)).error,
    "anonymous import denied",
  );
  console.log(count + " recipe import checks passed");
} finally {
  for (const id of users) {
    const r = await admin.auth.admin.deleteUser(id);
    if (r.error) throw r.error;
  }
  await sql.end();
}
