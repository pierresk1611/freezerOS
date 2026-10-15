import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { localConfig } from "./local-env.mjs";
const cfg = localConfig(),
  name = "freezer_mealprep_" + randomUUID().replaceAll("-", "");
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
    .filter((f) => f.endsWith(".sql") && f < "202610150012")
    .sort())
    await db.query(readFileSync("supabase/migrations/" + f, "utf8"));
  const owner = randomUUID(),
    other = randomUUID();
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  const document = JSON.parse(
    readFileSync("docs/meal-prep-import.example.json", "utf8"),
  );
  const importDoc = async (
    doc,
    keys = doc.recipes.map((r) => r.key),
    reuse = {},
  ) =>
    (
      await db.query("select public.import_meal_prep($1,$2,$3) id", [
        JSON.stringify(doc),
        JSON.stringify(keys),
        JSON.stringify(reuse),
      ])
    ).rows[0].id;
  const id = await importDoc(document);
  check(
    (await db.query("select * from public.meal_prep_projects")).rows.length ===
      1,
    "one project created",
  );
  check(
    (await db.query("select * from public.meal_prep_project_recipes")).rows
      .length === 3,
    "three immutable library references persisted",
  );
  check(
    (await db.query("select * from public.recipe_versions")).rows.length === 3,
    "three full recipes imported through existing importer",
  );
  check(
    (await db.query("select * from public.inventory_packages")).rows.length ===
      0,
    "import creates no physical inventory",
  );
  check(
    (await db.query("select * from public.cooking_batches")).rows.length === 0,
    "import creates no real batches",
  );
  check(
    (await db.query("select * from public.purchase_receipts")).rows.length ===
      0,
    "AI estimate never posts a purchase",
  );
  check(
    (await importDoc(document)) === id,
    "same importId returns same project",
  );
  check(
    (await db.query("select count(*) n from public.recipe_versions")).rows[0]
      .n === "3",
    "repeated import creates no recipe duplicates",
  );
  await assert.rejects(
    importDoc({ ...document, name: "Changed" }),
    /SOURCE_CHANGED/,
  );
  check(true, "changed content under same importId rejected");
  const second = { ...document, importId: randomUUID() };
  await importDoc(second);
  check(
    (await db.query("select count(*) n from public.recipe_versions")).rows[0]
      .n === "3",
    "different project reuses identical recipes without overwriting",
  );
  const versionBefore = (
    await db.query("select * from public.recipe_versions order by id")
  ).rows;
  const project = (
    await db.query("select * from public.meal_prep_projects where id=$1", [id])
  ).rows[0];
  const rows = (
    await db.query(
      "select id,local_key,recipe_version_id,portions from public.meal_prep_project_recipes where project_id=$1 order by id",
      [id],
    )
  ).rows.map((r) => ({ ...r, portions: Number(r.portions) }));
  const plan = {
    id: project.shopping_plan_id,
    revision: 0,
    name: project.name,
    status: "draft",
    recipes: rows.map((r) => ({
      id: r.id,
      recipe_version_id: r.recipe_version_id,
      portions: r.portions,
      from_freezer: 0,
      meal_entry_id: null,
    })),
    items: [
      {
        id: randomUUID(),
        ingredient_key: "manual",
        name: "Vákuové vrecká",
        unit: "ks",
        required: 0,
        quantity: 10,
        manual: true,
        checked: true,
        origins: [],
        selection: null,
      },
    ],
  };
  const edit = (revision, rs, pl, status = "planned", request = randomUUID()) =>
    db.query("select public.edit_meal_prep($1,$2,$3,$4,$5,$6)", [
      request,
      id,
      revision,
      JSON.stringify(rs),
      JSON.stringify(pl),
      status,
    ]);
  const request = randomUUID();
  await edit(0, rows, plan, "planned", request);
  await edit(0, rows, plan, "planned", request);
  check(
    (
      await db.query(
        "select revision from public.meal_prep_projects where id=$1",
        [id],
      )
    ).rows[0].revision === 1,
    "project and shopping save idempotently together",
  );
  await assert.rejects(
    edit(0, rows, { ...plan, revision: 1 }),
    /REVISION_CONFLICT/,
  );
  check(true, "stale project revision denied");
  await assert.rejects(
    db.query("select public.save_shopping_plan($1,$2)", [
      randomUUID(),
      JSON.stringify({ ...plan, revision: 1 }),
    ]),
    /PROJECT_USE_MEAL_PREP/,
  );
  check(true, "standalone shopping cannot desynchronise project recipes");
  const ten = {
    ...document,
    importId: randomUUID(),
    name: "Ten recipes",
    recipes: Array.from({ length: 10 }, (_, i) => ({
      ...document.recipes[1],
      key: "recipe_" + i,
      recipe: {
        ...document.recipes[1].recipe,
        name: "Distinct recipe " + i,
        ingredients: [
          { name: "Test ingredient " + i, quantity: 100 + i, unit: "g" },
        ],
      },
    })),
    timeline: [],
    meal_plan: [],
  };
  const count = (await db.query("select count(*) n from public.recipes"))
    .rows[0].n;
  const tenId = await importDoc(ten);
  check(
    Number(
      (await db.query("select count(*) n from public.recipes")).rows[0].n,
    ) -
      Number(count) ===
      10,
    "one AI document creates exactly ten distinct recipes",
  );
  await importDoc(ten);
  check(
    (
      await db.query(
        "select count(*) n from public.meal_prep_project_recipes where project_id=$1",
        [tenId],
      )
    ).rows[0].n === "10",
    "ten-recipe project replay stays at ten",
  );
  const mainRow = rows.find((r) => r.local_key === "pork"),
    sideRow = rows.find((r) => r.local_key === "rice");
  const mainVersion = (
    await db.query("select * from public.recipe_versions where id=$1", [
      mainRow.recipe_version_id,
    ])
  ).rows[0];
  const sideVersion = (
    await db.query("select * from public.recipe_versions where id=$1", [
      sideRow.recipe_version_id,
    ])
  ).rows[0];
  check(
    mainVersion.metadata.compatible_side_ids.includes(sideVersion.recipe_id),
    "local side references resolve to owned library IDs",
  );
  const meal = {
    id: randomUUID(),
    recipe_version_id: mainRow.recipe_version_id,
    meal_date: "2026-10-19",
    slot: "lunch",
    portions: 2,
    components: [{ recipe_version_id: sideRow.recipe_version_id, portions: 2 }],
  };
  const calRequest = randomUUID();
  const cal = () =>
    db.query("select public.apply_meal_prep_calendar($1,$2,1,$3,$4)", [
      calRequest,
      id,
      JSON.stringify([meal]),
      "[]",
    ]);
  await cal();
  await cal();
  check(
    (await db.query("select * from public.meal_plan_entries")).rows.length ===
      1,
    "explicit calendar application is idempotent",
  );
  await assert.rejects(
    db.query("select public.apply_meal_prep_calendar($1,$2,1,$3,$4)", [
      randomUUID(),
      id,
      JSON.stringify([meal]),
      "[]",
    ]),
    /ALREADY_APPLIED/,
  );
  check(true, "second calendar application cannot duplicate entries");
  await db.query("select public.create_batch($1,$2,1200,3,null,$3)", [
    mainRow.recipe_version_id,
    randomUUID(),
    "2026-12-31",
  ]);
  const batch = (await db.query("select * from public.cooking_batches"))
    .rows[0];
  const inventory = (
    await db.query("select * from public.inventory_packages order by id")
  ).rows;
  const linkReq = randomUUID();
  const link = () =>
    db.query("select public.link_meal_prep_batch($1,$2,$3,$4,6)", [
      linkReq,
      id,
      mainRow.id,
      batch.id,
    ]);
  await link();
  await link();
  check(
    (await db.query("select * from public.meal_prep_batch_links")).rows
      .length === 1,
    "actual batch is linked once after explicit confirmation",
  );
  check(
    JSON.stringify(inventory) ===
      JSON.stringify(
        (await db.query("select * from public.inventory_packages order by id"))
          .rows,
      ),
    "linking existing batch creates no duplicate stock receipt",
  );
  await edit(1, rows, { ...plan, revision: 1 }, "purchased");
  await assert.rejects(
    edit(
      2,
      rows.map((r) => ({ ...r, portions: r.portions + 1 })),
      { ...plan, revision: 2 },
    ),
    "project must not rewrite purchased recipe plan",
  );
  check(true, "purchased project recipes locked");
  check(
    JSON.stringify(versionBefore) ===
      JSON.stringify(
        (
          await db.query(
            "select * from public.recipe_versions where id=any($1) order by id",
            [versionBefore.map((v) => v.id)],
          )
        ).rows,
      ),
    "all original versions remain byte-for-byte unchanged",
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  await db.query("set role authenticated");
  for (const table of [
    "meal_prep_projects",
    "meal_prep_project_recipes",
    "meal_prep_calendar_links",
    "meal_prep_batch_links",
  ])
    check(
      (await db.query("select * from public." + table)).rows.length === 0,
      "RLS isolates " + table,
    );
  await assert.rejects(edit(3, rows, plan), /not found/i);
  check(true, "foreign project mutation denied");
  await assert.rejects(
    db.query("insert into public.meal_prep_projects(id) values($1)", [
      randomUUID(),
    ]),
    /permission denied/,
  );
  check(true, "direct project mutation denied");
  await db.query("set role anon");
  await assert.rejects(
    importDoc({ ...document, importId: randomUUID() }),
    /permission denied/,
  );
  check(true, "anonymous import denied");
  console.log(`${checks} meal-prep database checks passed.`);
} finally {
  if (db) await db.end();
  await admin.query(`drop database if exists "${name}" with(force)`);
  await admin.end();
}
