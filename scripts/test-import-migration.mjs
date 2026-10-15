import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { localConfig } from "./local-env.mjs";
const cfg = localConfig(),
  name = "freezer_import_" + randomUUID().replaceAll("-", "");
const admin = new pg.Client({ connectionString: cfg.DB_URL });
await admin.connect();
let db,
  created = false;
try {
  await admin.query(`create database "${name}"`);
  created = true;
  const url = new URL(cfg.DB_URL);
  url.pathname = "/" + name;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(
    `create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;`,
  );
  for (const f of readdirSync("supabase/migrations")
    .filter(
      (f) => f.endsWith(".sql") && f < "202610150008_recipe_batch_import.sql",
    )
    .sort())
    await db.query(readFileSync("supabase/migrations/" + f, "utf8"));
  const id = randomUUID(),
    file = randomUUID(),
    batch = randomUUID();
  await db.query("insert into auth.users values($1)", [id]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  const recipe = {
    name: "Original preserved",
    portions: 2,
    ingredients: [{ name: "Mäso", quantity: 1000, unit: "g" }],
    steps: ["Dusiť."],
    reheating: "Ohriať.",
    storage: "Schladiť.",
    freezing: true,
    meat: "beef",
  };
  await db.query("select public.import_recipes($1,$2)", [
    file,
    JSON.stringify([recipe]),
  ]);
  const version = (await db.query("select id from public.recipe_versions"))
    .rows[0].id;
  await db.query(
    "select public.create_batch($1,$2,1000,2,12345,'2026-12-31')",
    [version, batch],
  );
  const snapshots = {};
  for (const t of [
    "recipes",
    "recipe_versions",
    "cooking_batches",
    "inventory_packages",
    "inventory_movements",
    "operation_requests",
  ])
    snapshots[t] = (
      await db.query(`select * from public.${t} order by id`)
    ).rows;
  const functions = (
    await db.query(
      "select oid,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace order by oid",
    )
  ).rows;
  await db.query(
    readFileSync(
      "supabase/migrations/202610150008_recipe_batch_import.sql",
      "utf8",
    ),
  );
  for (const f of functions)
    assert.equal(
      (await db.query("select pg_get_functiondef($1) def", [f.oid])).rows[0]
        .def,
      f.def,
    );
  console.log("PASS migration 008 leaves every previous RPC unchanged");
  for (const [t, rows] of Object.entries(snapshots))
    assert.deepEqual(
      (await db.query(`select * from public.${t} order by id`)).rows,
      rows,
    );
  console.log(
    "PASS migration 008 preserves all existing recipes, batches, stock and cost snapshots",
  );
  const replay = (
    await db.query(
      "select public.import_recipe_item($1,$2,0,'new',null) result",
      [file, JSON.stringify([recipe])],
    )
  ).rows[0].result;
  assert.equal(replay.reason, "already");
  assert.equal(
    (await db.query("select count(*)::int n from public.recipe_versions"))
      .rows[0].n,
    1,
  );
  console.log("PASS full 001–008 schema safely recognizes a legacy source");
  await db.query("delete from auth.users where id=$1", [id]);
  assert.equal(
    (await db.query("select count(*)::int n from public.recipe_import_items"))
      .rows[0].n,
    0,
  );
  console.log("PASS account deletion cascades through import ledger");
} finally {
  if (db) await db.end();
  if (created) await admin.query(`drop database "${name}"`);
  await admin.end();
}
