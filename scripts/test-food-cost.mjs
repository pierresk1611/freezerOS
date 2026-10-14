import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { localConfig } from "./local-env.mjs";
const cfg = localConfig();
const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const sql = new pg.Client({ connectionString: cfg.DB_URL });
await sql.connect();
const users = [];
let count = 0;
const check = (v, n) => {
  assert.ok(v, n);
  count++;
  console.log("PASS " + n);
};
async function user() {
  const email = `food-${randomUUID()}@freezer.test`,
    password = randomUUID() + "aA1!";
  const u = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (u.error) throw u.error;
  users.push(u.data.user.id);
  const c = createClient(cfg.API_URL, cfg.ANON_KEY, {
    auth: { persistSession: false },
  });
  await c.auth.signInWithPassword({ email, password });
  return c;
}
const item = (name, total, category = "beef") => ({
  name,
  category,
  quantity: 500,
  unit: "g",
  unit_price_minor: 22000,
  discount_minor: 1000,
  total_minor: total,
  confidence: 0.9,
  ingredient_name: "Hovädzia kližka",
  product_name: "Kližka",
});
const payload = {
  merchant: "Test obchod",
  date: "2026-10-14",
  order_number: "test-order",
  currency: "CZK",
  total_minor: 12000,
  items: [
    item("Hovädzia kližka", 10000),
    {
      ...item("Vákuové sáčky", 2000, "equipment"),
      quantity: null,
      unit: null,
      ingredient_name: null,
      product_name: null,
    },
  ],
};
try {
  const a = await user(),
    b = await user();
  const id = randomUUID();
  let r = await a.rpc("create_purchase_draft", { p_id: id });
  check(!r.error, "manual draft creation");
  check(
    !(await a.rpc("create_purchase_draft", { p_id: id })).error,
    "draft retry idempotent",
  );
  check(
    (await b.from("purchase_receipts").select("*")).data.length === 0,
    "receipt RLS between users",
  );
  check(
    !!(
      await b.rpc("save_purchase", {
        p_receipt: id,
        p_request: randomUUID(),
        p_revision: 0,
        p_data: payload,
      })
    ).error,
    "foreign confirmation denied",
  );
  check(
    !!(
      await a.from("purchase_receipt_items").insert({
        user_id: users[0],
        receipt_id: id,
        name: "Direct injection",
        category: "food",
        total_minor: 9,
        position: 0,
      })
    ).error,
    "direct item mutation denied",
  );
  let request = randomUUID();
  r = await a.rpc("save_purchase", {
    p_receipt: id,
    p_request: request,
    p_revision: 0,
    p_data: { ...payload, total_minor: 100 },
  });
  check(!!r.error, "sum mismatch rejected");
  check(
    (await a.from("purchase_receipts").select("status").eq("id", id).single())
      .data.status === "draft",
    "bad confirm rolls back",
  );
  r = await a.rpc("save_purchase", {
    p_receipt: id,
    p_request: request,
    p_revision: 0,
    p_data: payload,
  });
  check(!r.error, "confirm actual discounted totals");
  r = await a.rpc("save_purchase", {
    p_receipt: id,
    p_request: request,
    p_revision: 0,
    p_data: payload,
  });
  check(!r.error, "repeat confirmation idempotent");
  check(
    (await a.from("purchase_receipts").select("*").eq("status", "confirmed"))
      .data.length === 1,
    "one counted purchase",
  );
  const price = await a
    .from("purchase_price_history")
    .select("*")
    .eq("name", "Hovädzia kližka")
    .single();
  check(
    Number(price.data.normalized_price_minor) === 20000,
    "paid discount normalized to CZK/kg",
  );
  check(
    (
      await a
        .from("purchase_price_history")
        .select("*")
        .eq("name", "Vákuové sáčky")
        .single()
    ).data.normalized_price_minor === null,
    "unknown weight never invents price/kg",
  );
  check(
    (await b.from("purchase_price_history").select("*")).data.length === 0,
    "price history RLS",
  );
  check(
    (await a.from("meal_logs").select("*")).data.length === 0,
    "purchase creates no consumption",
  );
  check(
    (await a.from("inventory_packages").select("*")).data.length === 0,
    "purchase creates no inventory value",
  );
  const other = randomUUID();
  await a.rpc("create_purchase_draft", { p_id: other });
  r = await a.rpc("save_purchase", {
    p_receipt: other,
    p_request: randomUUID(),
    p_revision: 0,
    p_data: payload,
  });
  check(
    r.error?.message.includes("POSSIBLE_DUPLICATE"),
    "order duplicate denied",
  );
  r = await a.rpc("save_purchase", {
    p_receipt: other,
    p_request: randomUUID(),
    p_revision: 0,
    p_data: payload,
    p_duplicate_confirmed: null,
  });
  check(!!r.error, "null duplicate override cannot bypass");
  r = await a.rpc("save_purchase", {
    p_receipt: id,
    p_request: randomUUID(),
    p_revision: null,
    p_data: payload,
  });
  check(!!r.error, "null revision cannot bypass concurrency");
  const corrected = {
    ...payload,
    total_minor: 11000,
    items: [item("Hovädzia kližka", 9000), payload.items[1]],
  };
  r = await a.rpc("save_purchase", {
    p_receipt: id,
    p_request: randomUUID(),
    p_revision: 1,
    p_data: corrected,
  });
  check(!r.error, "correction updates same purchase");
  check(
    (await a.from("purchase_receipts").select("*").eq("status", "confirmed"))
      .data.length === 1,
    "correction not double counted",
  );
  const audit = await a.from("purchase_audit").select("*").eq("receipt_id", id);
  check(
    audit.data.length === 2 && audit.data[1].before_data !== null,
    "immutable prior purchase audit",
  );
  r = await a.rpc("save_purchase", {
    p_receipt: id,
    p_request: randomUUID(),
    p_revision: 1,
    p_data: corrected,
  });
  check(!!r.error, "stale correction rejected");
  const refund = randomUUID();
  await a.rpc("create_purchase_draft", { p_id: refund });
  r = await a.rpc("save_purchase", {
    p_receipt: refund,
    p_request: randomUUID(),
    p_revision: 0,
    p_data: {
      ...payload,
      order_number: "refund",
      total_minor: -2000,
      items: [{ ...item("Vratka", -2000), quantity: 100, discount_minor: 0 }],
    },
  });
  check(!r.error, "negative refund accepted");
  const rows = (
    await a.from("purchase_receipts").select("*").eq("status", "confirmed")
  ).data;
  check(
    rows.reduce((s, x) => s + Number(x.total_minor), 0) === 9000,
    "monthly purchase sum includes refund",
  );
  r = await a.rpc("cancel_purchase", {
    p_receipt: id,
    p_request: randomUUID(),
    p_revision: 2,
  });
  check(!r.error, "cancel preserves historical receipt");
  check(
    (await a.from("purchase_price_history").select("*").eq("receipt_id", id))
      .data.length === 0,
    "cancel excluded from price history",
  );
  check(
    (await a.from("purchase_receipt_items").select("*").eq("receipt_id", id))
      .data.length === 2,
    "cancel retains audit item content",
  );
  r = await a.rpc("save_purchase_draft", {
    p_receipt: other,
    p_revision: 0,
    p_data: { ...payload, merchant: "", total_minor: null },
  });
  check(!r.error, "incomplete draft saved without financial event");
  check(
    (
      await a
        .from("purchase_receipts")
        .select("draft_data")
        .eq("id", other)
        .single()
    ).data.draft_data.total_minor === null,
    "unknown amount remains null",
  );
  const job = await a.rpc("begin_purchase_import", { p_receipt: other });
  check(!job.error, "recognition job starts");
  check(
    !!(await a.rpc("begin_purchase_import", { p_receipt: other })).error,
    "concurrent recognition denied",
  );
  check(
    !(
      await a.rpc("record_purchase_import", {
        p_job: job.data,
        p_status: "failed",
        p_result: null,
      })
    ).error,
    "OCR failure audited",
  );
  check(
    (
      await a
        .from("purchase_receipts")
        .select("status")
        .eq("id", other)
        .single()
    ).data.status === "draft",
    "recognition never confirms purchase",
  );
  for (const table of [
    "purchase_merchants",
    "purchase_products",
    "purchase_product_aliases",
    "purchase_receipt_items",
    "purchase_audit",
    "purchase_import_jobs",
  ])
    check(
      (await b.from(table).select("*")).data.length === 0,
      table + " isolated",
    );
  const budget = await a
    .from("purchase_budgets")
    .insert({ user_id: users[0], month: "2026-10-01", amount_minor: 100000 });
  check(!budget.error, "own monthly budget");
  check(
    (await b.from("purchase_budgets").select("*")).data.length === 0,
    "budget isolated",
  );
  const storage = (
    await sql.query(
      "select public from storage.buckets where id='purchase-receipts'",
    )
  ).rows[0];
  check(storage.public === false, "documents bucket private");
  const documents = [];
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "white" },
  })
    .webp()
    .toBuffer();
  const hash = createHash("sha256").update(bytes).digest("hex");
  for (let n = 0; n < 2; n++) {
    const root = randomUUID(),
      file = randomUUID(),
      path = `${users[0]}/${root}/${file}`;
    await a.rpc("create_purchase_draft", { p_id: root });
    check(
      !(
        await a.storage
          .from("purchase-receipts")
          .upload(path, bytes, { contentType: "image/webp" })
      ).error,
      "private receipt upload",
    );
    check(
      !(
        await a.rpc("attach_purchase_file", {
          p_id: file,
          p_receipt: root,
          p_hash: hash,
          p_mime: "image/webp",
          p_filename: "test.webp",
          p_path: path,
        })
      ).error,
      "receipt file ownership attachment",
    );
    documents.push({ root, path });
  }
  check(
    !!(
      await b.storage
        .from("purchase-receipts")
        .createSignedUrl(documents[0].path, 60)
    ).error,
    "foreign document URL denied",
  );
  const signed = await a.storage
    .from("purchase-receipts")
    .createSignedUrl(documents[0].path, 60);
  check((await fetch(signed.data.signedUrl)).ok, "own document readable");
  check(
    (await b.from("purchase_receipt_files").select("*")).data.length === 0,
    "document metadata RLS",
  );
  const paid = {
    ...payload,
    merchant: "Document vendor",
    order_number: "unique-document",
    total_minor: 100,
    items: [{ ...item("Unique item", 100), discount_minor: 0 }],
  };
  check(
    !(
      await a.rpc("save_purchase", {
        p_receipt: documents[0].root,
        p_request: randomUUID(),
        p_revision: 0,
        p_data: paid,
      })
    ).error,
    "first document purchase confirmed",
  );
  check(
    (
      await a.rpc("save_purchase", {
        p_receipt: documents[1].root,
        p_request: randomUUID(),
        p_revision: 0,
        p_data: {
          ...paid,
          merchant: "Other vendor",
          order_number: "another-document",
        },
      })
    ).error?.message.includes("POSSIBLE_DUPLICATE"),
    "same document hash across merchant spelling detected",
  );
  const concurrent = [randomUUID(), randomUUID()];
  for (const root of concurrent)
    await a.rpc("create_purchase_draft", { p_id: root });
  const cp = {
    ...paid,
    merchant: "Concurrent vendor",
    order_number: "concurrent-order",
  };
  const attempts = await Promise.all(
    concurrent.map((root) =>
      a.rpc("save_purchase", {
        p_receipt: root,
        p_request: randomUUID(),
        p_revision: 0,
        p_data: cp,
      }),
    ),
  );
  check(
    attempts.filter((x) => !x.error).length === 1,
    "concurrent duplicate confirmations count once",
  );
  const losing = concurrent[attempts.findIndex((x) => x.error)];
  check(
    !(
      await a.rpc("save_purchase", {
        p_receipt: losing,
        p_request: randomUUID(),
        p_revision: 0,
        p_data: cp,
        p_duplicate_confirmed: true,
      })
    ).error,
    "explicit legitimate duplicate override",
  );
  check(
    (
      await a
        .from("purchase_receipt_items")
        .select("product_name,ingredient_name")
        .eq("receipt_id", id)
    ).data[0].ingredient_name !== undefined,
    "historical mapping snapshot present",
  );
  console.log(`${count} Food Cost database checks passed`);
} finally {
  for (const id of users) {
    const folders = await admin.storage.from("purchase-receipts").list(id);
    for (const folder of folders.data ?? []) {
      const files = await admin.storage
        .from("purchase-receipts")
        .list(`${id}/${folder.name}`);
      if (files.data?.length)
        await admin.storage
          .from("purchase-receipts")
          .remove(files.data.map((f) => `${id}/${folder.name}/${f.name}`));
    }
    const deleted = await admin.auth.admin.deleteUser(id);
    if (deleted.error) throw deleted.error;
  }
  await sql.end();
}
