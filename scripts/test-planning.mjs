import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { localConfig } from "./local-env.mjs";
const cfg = localConfig(),
  name = "freezer_planning_" + randomUUID().replaceAll("-", "");
const admin = new pg.Client({ connectionString: cfg.DB_URL });
await admin.connect();
let db;
let checks = 0;
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
    .filter((f) => f.endsWith(".sql") && f < "202610150009")
    .sort())
    await db.query(readFileSync("supabase/migrations/" + f, "utf8"));
  const owner = randomUUID(),
    other = randomUUID();
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  const recipe = {
    name: "Test meal009",
    portions: 2,
    ingredients: [{ name: "Cibuľa", quantity: 300, unit: "g" }],
    steps: ["Variť"],
    storage: "Schladiť",
    reheating: "Ohriať",
    meat: "none",
    freezing: true,
  };
  await db.query("select public.import_recipes($1,$2)", [
    randomUUID(),
    JSON.stringify([recipe]),
  ]);
  const v = (await db.query("select id from public.recipe_versions")).rows[0]
    .id;
  await db.query(
    "select public.create_batch($1,$2,1000,2,12345,'2026-12-31')",
    [v, randomUUID()],
  );
  const stock = (
    await db.query("select * from public.inventory_packages order by id")
  ).rows;
  const historical = (
    await db.query("select * from public.cooking_batches order by id")
  ).rows;
  const functions = (
    await db.query(
      "select oid,proname,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace",
    )
  ).rows;
  const originalPurchase = functions.find((f) => f.proname === "save_purchase");
  await db.query(
    originalPurchase.def.replace(
      "declare r public.purchase_receipts;",
      "-- independent customization\ndeclare r public.purchase_receipts;",
    ),
  );
  await assert.rejects(
    db.query(
      readFileSync(
        "supabase/migrations/202610150009_planner_shopping.sql",
        "utf8",
      ),
    ),
    /PURCHASE_RPC_CHANGED/,
  );
  await db.query("rollback");
  check(
    true,
    "custom purchase RPC blocks migration instead of being overwritten",
  );
  check(
    (await db.query("select to_regclass('public.shopping_plans') as t")).rows[0]
      .t === null,
    "failed compatibility check rolls back all new DDL",
  );
  await db.query(originalPurchase.def);
  await db.query(
    readFileSync(
      "supabase/migrations/202610150009_planner_shopping.sql",
      "utf8",
    ),
  );
  for (const f of functions)
    assert.equal(
      (await db.query("select pg_get_functiondef($1) def", [f.oid])).rows[0]
        .def,
      f.proname === "save_purchase"
        ? f.def.replace(
            "cat not in('beef','pork','chicken','meat','vegetables','fruit','legumes','grains','potatoes','pasta','dairy','eggs','oil','sauces','spices','food','equipment','fees')",
            "not exists(select 1 from public.purchase_categories catalog where catalog.id=cat)",
          )
        : f.def,
    );
  check(
    true,
    "009 preserves all RPCs except the exact purchase category validation extension",
  );
  await db.query("set role authenticated");
  const meal = {
    id: randomUUID(),
    recipe_version_id: v,
    meal_date: "2026-10-15",
    slot: "lunch",
    portions: 2,
  };
  const request = randomUUID();
  const edit = (r, changes) =>
    db.query("select public.edit_meal_plan($1,$2)", [
      r,
      JSON.stringify(changes),
    ]);
  await edit(request, [meal]);
  await edit(request, [meal]);
  check(
    (await db.query("select * from public.meal_plan_entries")).rowCount === 1,
    "idempotent add",
  );
  await edit(randomUUID(), [
    { ...meal, revision: 0, meal_date: "2026-10-16", portions: 3 },
  ]);
  check(
    (await db.query("select * from public.meal_plan_entries")).rows[0]
      .revision === 1,
    "update retains logical ID and increments revision",
  );
  await assert.rejects(
    edit(randomUUID(), [{ ...meal, revision: 0 }]),
    /REVISION_CONFLICT/,
  );
  check(true, "stale edit rejected");
  const peers = [];
  try {
    for (let i = 0; i < 2; i++) {
      const peer = new pg.Client({ connectionString: url.toString() });
      await peer.connect();
      await peer.query("select set_config('request.jwt.claim.sub',$1,false)", [
        owner,
      ]);
      await peer.query("set role authenticated");
      peers.push(peer);
    }
    const concurrent = await Promise.allSettled(
      peers.map((peer) =>
        peer.query("select public.edit_meal_plan($1,$2)", [
          randomUUID(),
          JSON.stringify([{ ...meal, revision: 1, portions: 4 }]),
        ]),
      ),
    );
    check(
      concurrent.filter((x) => x.status === "fulfilled").length === 1,
      "concurrent edits allow one revision winner",
    );
  } finally {
    for (const peer of peers) await peer.end();
  }
  const settings = {
    persons: 2,
    perDay: 2,
    days: 7,
    priority: "variety",
    banned: ["ryby"],
  };
  await db.query("select public.save_planner_settings($1,$2)", [
    randomUUID(),
    JSON.stringify(settings),
  ]);
  await assert.rejects(
    db.query("select public.save_planner_settings($1,$2)", [
      randomUUID(),
      JSON.stringify(settings),
    ]),
    /REVISION_CONFLICT/,
  );
  check(true, "planner settings enforce revisions");
  await db.query("select public.save_ingredient_alias($1,$2)", [
    randomUUID(),
    JSON.stringify({ alias: "cibule", canonical: "cibula" }),
  ]);
  check(
    (await db.query("select * from public.ingredient_aliases")).rows[0]
      .canonical === "cibula",
    "confirmed ingredient alias persisted",
  );
  const pantry = {
    id: randomUUID(),
    name: "Cibuľa",
    ingredient_key: "cibula",
    quantity: 150,
    unit: "g",
    purchased_on: "2026-10-15",
    expires_on: null,
    location: "Špajza",
    cost_minor: null,
  };
  await db.query("select public.save_pantry_item($1,$2)", [
    randomUUID(),
    JSON.stringify(pantry),
  ]);
  check(
    (await db.query("select quantity from public.pantry_items")).rows[0]
      .quantity === "150.0000",
    "real pantry independent from finished packages",
  );
  const plan = {
    id: randomUUID(),
    name: "Test nákup",
    status: "draft",
    recipes: [
      {
        id: randomUUID(),
        recipe_version_id: v,
        portions: 2,
        from_freezer: 0,
        meal_entry_id: meal.id,
      },
    ],
    items: [
      {
        id: randomUUID(),
        ingredient_key: "cibula",
        name: "Cibuľa",
        unit: "g",
        required: 300,
        quantity: 150,
        manual: false,
        checked: false,
        origins: [{ recipe_version_id: v, quantity: 300 }],
        selection: null,
      },
    ],
  };
  const req = randomUUID();
  const save = (r, p) =>
    db.query("select public.save_shopping_plan($1,$2)", [r, JSON.stringify(p)]);
  await save(req, plan);
  await save(req, plan);
  check(
    (await db.query("select * from public.shopping_plans")).rowCount === 1,
    "shopping save replay does not duplicate",
  );
  await assert.rejects(
    save(randomUUID(), { ...plan, revision: 3 }),
    /REVISION_CONFLICT/,
  );
  check(true, "shopping stale revision rejected");
  await assert.rejects(
    save(randomUUID(), {
      ...plan,
      revision: 0,
      recipes: [{ ...plan.recipes[0], from_freezer: 2 }],
    }),
    /Insufficient/,
  );
  check(true, "gram-only stock cannot become known portions");
  await save(randomUUID(), { ...plan, revision: 0, status: "exported" });
  await assert.rejects(
    save(randomUUID(), { ...plan, revision: 1, recipes: [] }),
    /LOCKED_PLAN/,
  );
  check(true, "exported recipes cannot silently recalculate");
  await assert.rejects(
    save(randomUUID(), {
      ...plan,
      revision: 1,
      status: "purchased",
      items: [{ ...plan.items[0], quantity: 999 }],
    }),
    /LOCKED_PLAN/,
  );
  check(true, "exported item quantities cannot silently change");
  const receipt = randomUUID();
  const purchase = {
    merchant: "Test obchod 009",
    date: "2026-10-15",
    order_number: randomUUID(),
    currency: "CZK",
    total_minor: 3000,
    items: [
      {
        name: "Cibuľa",
        ingredient_name: "Cibuľa",
        product_name: "Cibuľa",
        quantity: 500,
        unit: "g",
        unit_price_minor: 2000,
        discount_minor: 0,
        total_minor: 1000,
        category: "vegetables",
        confidence: 1,
      },
      {
        name: "Víno",
        ingredient_name: null,
        product_name: "Víno",
        quantity: 1,
        unit: "ks",
        unit_price_minor: 2000,
        discount_minor: 0,
        total_minor: 2000,
        category: "alcohol",
        confidence: 1,
      },
    ],
  };
  await db.query("select public.create_purchase_draft($1)", [receipt]);
  await db.query("select public.save_purchase($1,$2,0,$3,false)", [
    receipt,
    randomUUID(),
    JSON.stringify(purchase),
  ]);
  const foodItem = (
    await db.query(
      "select id from public.purchase_receipt_items where receipt_id=$1 and category='vegetables'",
      [receipt],
    )
  ).rows[0].id;
  const alcoholItem = (
    await db.query(
      "select id from public.purchase_receipt_items where receipt_id=$1 and category='alcohol'",
      [receipt],
    )
  ).rows[0].id;
  await assert.rejects(
    db.query("select public.receive_receipt_pantry($1,$2,$3)", [
      randomUUID(),
      receipt,
      JSON.stringify([alcoholItem]),
    ]),
    /mapping/,
  );
  check(true, "alcohol cannot become ingredient pantry stock");
  const received = (
    await db.query("select public.receive_receipt_pantry($1,$2,$3) result", [
      randomUUID(),
      receipt,
      JSON.stringify([foodItem]),
    ])
  ).rows[0].result;
  check(
    received.imported === 1,
    "confirmed receipt needs separate pantry confirmation",
  );
  const replay = (
    await db.query("select public.receive_receipt_pantry($1,$2,$3) result", [
      randomUUID(),
      receipt,
      JSON.stringify([foodItem]),
    ])
  ).rows[0].result;
  check(
    replay.already === true && replay.imported === 0,
    "receipt pantry cannot receive twice",
  );
  await db.query("select public.save_purchase($1,$2,1,$3,false)", [
    receipt,
    randomUUID(),
    JSON.stringify({
      ...purchase,
      items: [
        { ...purchase.items[0], name: "Cibuľa opravená" },
        purchase.items[1],
      ],
    }),
  ]);
  check(
    (await db.query("select * from public.pantry_receipt_imports")).rowCount ===
      1,
    "receipt correction retains pantry import evidence and remains possible",
  );
  const syncPlan = {
    ...plan,
    id: randomUUID(),
    status: "draft",
    items: [],
    recipes: [{ ...plan.recipes[0], id: randomUUID() }],
    calendar_changes: [{ ...meal, revision: 2, portions: 5 }],
  };
  await save(randomUUID(), syncPlan);
  check(
    (
      await db.query(
        "select portions,revision from public.meal_plan_entries where id=$1",
        [meal.id],
      )
    ).rows[0].portions === "5.00",
    "explicit shopping calendar sync is transactional",
  );
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  await db.query("set role authenticated");
  check(
    (await db.query("select * from public.shopping_plans")).rowCount === 0,
    "second user cannot read shopping plans",
  );
  check(
    (await db.query("select * from public.pantry_items")).rowCount === 0,
    "second user cannot read pantry",
  );
  await assert.rejects(
    edit(randomUUID(), [{ ...meal, revision: 1 }]),
    /Not found/,
  );
  check(true, "second user cannot modify meal");
  await assert.rejects(
    save(randomUUID(), { ...plan, revision: 1 }),
    /Not found/,
  );
  check(true, "second user cannot modify shopping plan");
  await assert.rejects(
    db.query("update public.pantry_items set quantity=0"),
    /permission denied/,
  );
  check(true, "direct unaudited pantry writes denied");
  await assert.rejects(
    db.query(
      "insert into public.shopping_plans(id,user_id,name) values($1,$2,$3)",
      [randomUUID(), other, "Bypass"],
    ),
    /permission denied/,
  );
  check(true, "direct shopping writes denied");
  await db.query("reset role");
  check(
    JSON.stringify(
      (await db.query("select * from public.inventory_packages order by id"))
        .rows,
    ) === JSON.stringify(stock),
    "planning never changes inventory",
  );
  check(
    JSON.stringify(
      (await db.query("select * from public.cooking_batches order by id")).rows,
    ) === JSON.stringify(historical),
    "historical batch costs unchanged",
  );
  check(
    (
      await db.query(
        "select count(*) from public.purchase_categories where id in('alcohol','drugstore') and kind<>'food'",
      )
    ).rows[0].count === "2",
    "alcohol and drugstore excluded from food",
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  await db.query("set role anon");
  await assert.rejects(edit(randomUUID(), [meal]), /permission denied/);
  check(true, "anonymous RPC execution denied");
  console.log(`${checks} planning migration and database checks passed.`);
} finally {
  if (db) await db.end();
  await admin.query(`drop database if exists "${name}" with(force)`);
  await admin.end();
}
