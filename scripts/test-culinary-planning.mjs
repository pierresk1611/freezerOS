import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { localConfig } from "./local-env.mjs";
const cfg = localConfig(),
  name = "freezer_culinary_" + randomUUID().replaceAll("-", "");
const admin = new pg.Client({ connectionString: cfg.DB_URL });
await admin.connect();
let db,
  checks = 0;
const check = (c, label) => {
  assert.ok(c, label);
  checks++;
  console.log("PASS " + label);
};
try {
  await admin.query(`create database "${name}"`);
  const url = new URL(cfg.DB_URL);
  url.pathname = "/" + name;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(
    `create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;`,
  );
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql") && f < "202610150010")
    .sort())
    await db.query(readFileSync("supabase/migrations/" + f, "utf8"));
  const owner = randomUUID(),
    other = randomUUID();
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  const raw = {
    name: "Potato mash original",
    portions: 2,
    ingredients: [{ name: "Zemiaky", quantity: 500, unit: "g" }],
    steps: ["Uvariť a rozmixovať."],
    meat: "none",
    storage: "Schladiť.",
    reheating: "Prehriať.",
    freezing: true,
  };
  await db.query("select public.import_recipes($1,$2)", [
    randomUUID(),
    JSON.stringify([raw]),
  ]);
  const before = (await db.query("select * from public.recipe_versions")).rows;
  await db.query("select public.create_batch($1,$2,1000,2,12345,$3)", [
    before[0].id,
    randomUUID(),
    "2026-12-31",
  ]);
  const stock = (
    await db.query("select * from public.inventory_packages order by id")
  ).rows;
  const cooked = (
    await db.query("select * from public.cooking_batches order by id")
  ).rows;
  await db.query(
    readFileSync(
      "supabase/migrations/202610150010_culinary_planner.sql",
      "utf8",
    ),
  );
  check(
    JSON.stringify(before) ===
      JSON.stringify(
        (await db.query("select * from public.recipe_versions")).rows,
      ),
    "010 preserves existing versions unchanged",
  );
  const roleRequest = randomUUID();
  const rows = [
    {
      version_id: before[0].id,
      meal_role: "side",
      allowed_slots: ["lunch", "dinner"],
      side_policy: "none",
      compatible_side_ids: [],
    },
  ];
  const classify = () =>
    db.query("select public.classify_recipe_roles($1,$2)", [
      roleRequest,
      JSON.stringify(rows),
    ]);
  await classify();
  await classify();
  const versions = (
    await db.query("select * from public.recipe_versions order by version")
  ).rows;
  check(
    versions.length === 2 &&
      versions[0].id === before[0].id &&
      versions[1].metadata.meal_role === "side",
    "explicit classification creates one idempotent new version",
  );
  const side = versions[1];
  const create = async (recipe) => {
    const id = randomUUID();
    await db.query("select public.create_recipe_with_id($1,$2)", [
      id,
      JSON.stringify(recipe),
    ]);
    return (
      await db.query(
        "select * from public.recipe_versions where recipe_id=$1",
        [id],
      )
    ).rows[0];
  };
  const main = await create({
    ...raw,
    name: "Pulled meat",
    meal_role: "main",
    allowed_slots: ["lunch", "dinner"],
    side_policy: "required",
    compatible_side_ids: [side.recipe_id],
  });
  const complete = await create({
    ...raw,
    name: "Complete soup",
    meal_role: "complete",
    allowed_slots: ["lunch", "dinner"],
    side_policy: "none",
  });
  const batch = {
    id: randomUUID(),
    recipe_version_id: main.id,
    cooking_date: "2026-10-11",
    portions: 6,
  };
  const entries = Array.from({ length: 3 }, (_, i) => ({
    id: randomUUID(),
    recipe_version_id: main.id,
    meal_date: "2026-10-" + (12 + i),
    slot: "lunch",
    portions: 2,
    planned_batch_id: batch.id,
    components: [{ recipe_version_id: side.id, portions: 2 }],
  }));
  const request = randomUUID();
  const save = (changes, batches = [], automatic = true, req = randomUUID()) =>
    db.query("select public.save_meal_schedule($1,$2,$3,$4)", [
      req,
      JSON.stringify(changes),
      JSON.stringify(batches),
      automatic,
    ]);
  await save(entries, [batch], true, request);
  await save(entries, [batch], true, request);
  check(
    (await db.query("select * from public.meal_plan_entries")).rows.length ===
      3,
    "idempotent grouped schedule contains three meals",
  );
  check(
    (await db.query("select * from public.meal_plan_components")).rows
      .length === 3,
    "sides belong to logical meals",
  );
  const single = (id) => ({
    id: randomUUID(),
    recipe_version_id: id,
    meal_date: "2026-10-15",
    slot: "dinner",
    portions: 1,
  });
  await assert.rejects(save([single(side.id)]), /eligible/);
  check(true, "side rejected as automatic dinner");
  await assert.rejects(save([single(before[0].id)]), /eligible/);
  check(true, "unknown role rejected as automatic main");
  await assert.rejects(
    save([{ ...single(main.id), slot: "breakfast" }]),
    /eligible/,
  );
  check(true, "wrong daily slot rejected");
  await assert.rejects(
    save([{ ...single(main.id), components: [] }]),
    /Side required/,
  );
  check(true, "required side enforced");
  await assert.rejects(
    save([
      {
        ...single(main.id),
        planned_batch_id: batch.id,
        components: [{ recipe_version_id: side.id, portions: 1 }],
      },
    ]),
    /overallocated/,
  );
  check(true, "batch yield cannot be overallocated");
  await assert.rejects(
    save([{ ...batch, recipe_version_id: complete.id }]),
    /eligible|Invalid|Not found|null/,
  );
  check(true, "invalid meal payload rejected");
  await assert.rejects(
    save([], [{ ...batch, revision: 0, cooking_date: "2026-10-20" }]),
    /linked batch/,
  );
  check(true, "batch date change cannot invalidate attached meals");
  await assert.rejects(
    save([], [{ ...batch, revision: 0, recipe_version_id: complete.id }]),
    /linked batch/,
  );
  check(true, "batch recipe change cannot invalidate attached meals");
  const old = (
    await db.query("select * from public.meal_plan_entries where id=$1", [
      entries[0].id,
    ])
  ).rows[0];
  await save([
    {
      ...old,
      components: [{ recipe_version_id: side.id, portions: 2 }],
      meal_date: "2026-10-15",
    },
  ]);
  await assert.rejects(
    save([
      { ...old, components: [{ recipe_version_id: side.id, portions: 2 }] },
    ]),
    /REVISION_CONFLICT/,
  );
  check(true, "stale revisions rejected without duplicate meals");
  const concurrent = (
    await db.query("select * from public.meal_plan_entries where id=$1", [
      entries[2].id,
    ])
  ).rows[0];
  const peer = new pg.Client({ connectionString: url.toString() });
  await peer.connect();
  try {
    await peer.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    const changed = {
      ...concurrent,
      recipe_version_id: complete.id,
      planned_batch_id: null,
      components: [],
    };
    const args = () => [randomUUID(), JSON.stringify([changed]), "[]", false];
    const results = await Promise.allSettled([
      db.query("select public.save_meal_schedule($1,$2,$3,$4)", args()),
      peer.query("select public.save_meal_schedule($1,$2,$3,$4)", args()),
    ]);
    check(
      results.filter((r) => r.status === "fulfilled").length === 1 &&
        results.filter((r) => r.status === "rejected").length === 1,
      "concurrent same-revision edits produce one winner",
    );
  } finally {
    await peer.end();
  }
  await assert.rejects(
    save([{ ...single(complete.id), ready_portions: 1 }]),
    /Insufficient known freezer/,
  );
  check(true, "unknown freezer portions cannot be presented as available");
  const planId = randomUUID();
  await db.query("select public.save_shopping_plan($1,$2)", [
    randomUUID(),
    JSON.stringify({
      id: planId,
      name: "Original shopping",
      status: "draft",
      recipes: [
        {
          id: randomUUID(),
          recipe_version_id: main.id,
          portions: 6,
          from_freezer: 0,
          meal_entry_id: entries[1].id,
        },
      ],
      items: [],
    }),
  ]);
  const shopping = (
    await db.query("select * from public.shopping_plan_recipes")
  ).rows;
  const linked = (
    await db.query("select * from public.meal_plan_entries where id=$1", [
      entries[1].id,
    ])
  ).rows[0];
  await assert.rejects(save([{ ...linked, remove: true }]), /LINKED_SHOPPING/);
  await save([
    {
      ...linked,
      recipe_version_id: complete.id,
      planned_batch_id: null,
      components: [],
    },
  ]);
  check(
    JSON.stringify(shopping) ===
      JSON.stringify(
        (await db.query("select * from public.shopping_plan_recipes")).rows,
      ),
    "linked shopping never silently rewritten",
  );
  check(
    (
      await db.query(
        "select planner_review_required from public.shopping_plans where id=$1",
        [planId],
      )
    ).rows[0].planner_review_required,
    "linked shopping flagged for explicit review",
  );
  check(
    JSON.stringify(stock) ===
      JSON.stringify(
        (await db.query("select * from public.inventory_packages order by id"))
          .rows,
      ),
    "planning never decrements inventory",
  );
  check(
    JSON.stringify(cooked) ===
      JSON.stringify(
        (await db.query("select * from public.cooking_batches order by id"))
          .rows,
      ),
    "historical batches and costs unchanged",
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  await db.query("set role authenticated");
  check(
    (await db.query("select * from public.meal_plan_components")).rows
      .length === 0,
    "RLS hides other owner components",
  );
  check(
    (await db.query("select * from public.planned_cooking_batches")).rows
      .length === 0,
    "RLS hides other owner batches",
  );
  await assert.rejects(save([single(main.id)]), /not found/i);
  check(true, "cross owner recipe write denied");
  await assert.rejects(
    db.query(
      "insert into public.planned_cooking_batches(id,user_id,recipe_version_id,cooking_date,portions) values($1,$2,$3,$4,6)",
      [randomUUID(), other, main.id, "2026-10-11"],
    ),
    /permission denied/,
  );
  check(true, "direct writes denied");
  await assert.rejects(
    db.query("select public.edit_meal_plan_base_009($1,$2)", [
      randomUUID(),
      "[]",
    ]),
    /permission denied/,
  );
  check(true, "private compatibility helper cannot bypass checks");
  await db.query("set role anon");
  await assert.rejects(save([]), /permission denied/);
  check(true, "anonymous schedule execution denied");
  console.log(`${checks} culinary database checks passed.`);
} finally {
  if (db) await db.end();
  await admin.query(`drop database if exists "${name}" with(force)`);
  await admin.end();
}
