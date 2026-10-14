import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { localConfig } from "./local-env.mjs";
const config = localConfig(),
  name = "freezer_food_migration_" + randomUUID().replaceAll("-", "");
const admin = new pg.Client({ connectionString: config.DB_URL });
await admin.connect();
let db,
  created = false;
try {
  await admin.query(`create database "${name}"`);
  created = true;
  const url = new URL(config.DB_URL);
  url.pathname = "/" + name;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(
    `create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;`,
  );
  const files = readdirSync("supabase/migrations")
    .filter((x) => x.endsWith(".sql"))
    .sort();
  for (const f of files.filter((x) => !x.includes("007")))
    await db.query(readFileSync("supabase/migrations/" + f, "utf8"));
  const before = (
    await db.query(
      "select proname,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace order by proname",
    )
  ).rows;
  await db.query(
    readFileSync("supabase/migrations/202610140007_food_cost.sql", "utf8"),
  );
  const after = (
    await db.query(
      "select proname,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace order by proname",
    )
  ).rows;
  for (const f of before)
    assert.deepEqual(
      after.find((a) => a.proname === f.proname),
      f,
    );
  console.log(
    "PASS 001–007 full migration sequence, original RPC definitions unchanged",
  );
  const bucket = (
    await db.query(
      "select public from storage.buckets where id='purchase-receipts'",
    )
  ).rows[0];
  assert.equal(bucket.public, false);
  console.log("PASS isolated new private storage migration");
  const user = randomUUID(),
    receipt = randomUUID();
  await db.query("insert into auth.users values($1)", [user]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.query("select public.create_purchase_draft($1)", [receipt]);
  await db.query("select public.save_purchase($1,$2,0,$3)", [
    receipt,
    randomUUID(),
    {
      merchant: "Isolated test",
      date: "2026-10-14",
      currency: "CZK",
      order_number: "test",
      total_minor: 100,
      items: [
        {
          name: "Test beef",
          category: "beef",
          quantity: null,
          unit: null,
          unit_price_minor: null,
          discount_minor: 0,
          total_minor: 100,
          confidence: null,
          product_name: null,
          ingredient_name: null,
        },
      ],
    },
  ]);
  assert.equal(
    (
      await db.query(
        "select total_minor from public.purchase_receipts where id=$1",
        [receipt],
      )
    ).rows[0].total_minor,
    "100",
  );
  console.log(
    "PASS final fresh schema confirms purchase with category foreign keys",
  );
} finally {
  if (db) await db.end();
  if (created) await admin.query(`drop database "${name}"`);
  await admin.end();
}
