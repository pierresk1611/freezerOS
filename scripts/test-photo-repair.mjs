// Isolated temporary database: never drop tables/data from the running local application.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { localConfig } from "./local-env.mjs";
const local = localConfig();
const name = "freezer_photo_repair_" + randomUUID().replaceAll("-", "");
const admin = new pg.Client({ connectionString: local.DB_URL });
await admin.connect();
let created = false;
let database;
try {
  await admin.query(`create database "${name}"`);
  created = true;
  const url = new URL(local.DB_URL);
  url.pathname = "/" + name;
  database = new pg.Client({ connectionString: url.toString() });
  await database.connect();
  await database.query(
    `create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;`,
  );
  for (const file of [
    "202610140001_core.sql",
    "202610140002_recipes.sql",
    "202610140003_validation.sql",
    "202610140005_pulled_cubes.sql",
  ])
    await database.query(readFileSync("supabase/migrations/" + file, "utf8"));
  const user = randomUUID(),
    root = randomUUID();
  await database.query("insert into auth.users(id) values($1)", [user]);
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user,
  ]);
  await database.query("select public.create_recipe_with_id($1,$2)", [
    root,
    {
      name: "Recept s metadátami",
      portions: 2,
      ingredients: [{ name: "Mäso", quantity: 1200, unit: "g" }],
      steps: ["Pomaly piecť."],
      reheating: "Prehriať.",
      category: "slow_roasted_pulled_meat",
      oven_c: 150,
    },
  ]);
  const before = (
    await database.query(
      "select * from public.recipe_versions where recipe_id=$1",
      [root],
    )
  ).rows;
  const functions = (
    await database.query(
      "select proname,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and proname in('import_recipes','revise_recipe','create_recipe_with_id') order by proname",
    )
  ).rows;
  const repair = readFileSync(
    "supabase/migrations/202610140006_repair_photo_setup.sql",
    "utf8",
  );
  await database.query(repair);
  assert.equal(
    (
      await database.query(
        "select to_regclass('public.recipe_photos') is not null ok",
      )
    ).rows[0].ok,
    true,
  );
  console.log("PASS repair activates photos when 005 exists without 004");
  assert.deepEqual(
    (
      await database.query(
        "select * from public.recipe_versions where recipe_id=$1",
        [root],
      )
    ).rows,
    before,
  );
  console.log(
    "PASS repair preserves recipe IDs, versions and cooking metadata",
  );
  const id = randomUUID(),
    base = `${user}/${root}/${id}/`;
  await database.query(
    "insert into storage.objects(bucket_id,name) values('recipe-photos',$1),('recipe-photos',$2)",
    [base + "large.webp", base + "thumb.webp"],
  );
  await database.query("select public.add_recipe_photo($1,$2,$3)", [
    root,
    id,
    "Vlastný záber",
  ]);
  const photo = (
    await database.query("select * from public.recipe_photos where id=$1", [id])
  ).rows;
  await database.query(repair);
  assert.deepEqual(
    (
      await database.query("select * from public.recipe_photos where id=$1", [
        id,
      ])
    ).rows,
    photo,
  );
  console.log("PASS repeated repair preserves existing photo metadata");
  assert.deepEqual(
    (
      await database.query(
        "select proname,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and proname in('import_recipes','revise_recipe','create_recipe_with_id') order by proname",
      )
    ).rows,
    functions,
  );
  console.log("PASS repair never downgrades recipe RPCs");
  assert.equal(
    (
      await database.query(
        "select public=false private from storage.buckets where id='recipe-photos'",
      )
    ).rows[0].private,
    true,
  );
  console.log("PASS repaired bucket stays private");
} finally {
  if (database) await database.end();
  if (created) await admin.query(`drop database "${name}"`);
  await admin.end();
}
