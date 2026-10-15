import { db } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mealSchema } from "@/lib/planning";
const requestSchema = z.object({
  request: z.string().uuid(),
  action: z.enum([
    "meals",
    "shopping",
    "pantry",
    "settings",
    "alias",
    "receive",
  ]),
  data: z.unknown(),
});
const choice = z
  .object({
    id: z.string().uuid(),
    recipe_version_id: z.string().uuid(),
    portions: z.number().positive().max(100),
    from_freezer: z.number().nonnegative().max(100),
    meal_entry_id: z.string().uuid().nullable(),
  })
  .refine((x) => x.from_freezer <= x.portions);
const item = z.object({
  id: z.string().uuid(),
  ingredient_key: z.string().max(160),
  name: z.string().min(1).max(160),
  unit: z.enum(["g", "ml", "ks"]),
  required: z.number().nonnegative().max(1e9),
  quantity: z.number().nonnegative().max(1e9),
  manual: z.boolean(),
  checked: z.boolean(),
  origins: z
    .array(
      z.object({
        recipe_version_id: z.string().uuid(),
        quantity: z.number().nonnegative(),
      }),
    )
    .max(100),
  selection: z.record(z.string(), z.unknown()).nullable(),
});
const shopping = z.object({
  calendar_changes: z.array(mealSchema).max(100).optional(),
  id: z.string().uuid(),
  revision: z.number().int().nonnegative().optional(),
  name: z.string().min(1).max(160),
  status: z.enum([
    "draft",
    "ready",
    "exported",
    "partially_purchased",
    "purchased",
    "closed",
    "cancelled",
  ]),
  recipes: z.array(choice).max(100),
  items: z.array(item).max(500),
  receipt_id: z.string().uuid().nullable().optional(),
});
const pantry = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative().optional(),
  name: z.string().trim().min(1).max(120),
  ingredient_key: z.string().min(1).max(160),
  quantity: z.number().nonnegative().max(1e9),
  unit: z.enum(["g", "ml", "ks"]),
  purchased_on: z.iso.date().nullable(),
  expires_on: z.iso.date().nullable(),
  location: z.string().max(120),
  cost_minor: z.number().int().nonnegative().nullable(),
});
export async function POST(req: NextRequest) {
  let origin = "";
  try {
    origin = new URL(req.headers.get("origin") ?? "").host;
  } catch {}
  if (
    !origin ||
    origin !== req.headers.get("host") ||
    req.headers.get("sec-fetch-site") === "cross-site"
  )
    return NextResponse.json(
      { error: "Neplatný pôvod požiadavky." },
      { status: 403 },
    );
  const client = await db();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Prihláste sa znova." }, { status: 401 });
  try {
    const text = await req.text();
    if (text.length > 1000000) throw Error("Príliš veľká požiadavka.");
    const p = requestSchema.parse(JSON.parse(text));
    let result;
    if (p.action === "receive") {
      const data = z
        .object({
          receipt: z.string().uuid(),
          items: z.array(z.string().uuid()).min(1).max(200),
        })
        .parse(p.data);
      result = await client.rpc("receive_receipt_pantry", {
        p_request: p.request,
        p_receipt: data.receipt,
        p_items: data.items,
      });
    } else if (p.action === "alias") {
      result = await client.rpc("save_ingredient_alias", {
        p_request: p.request,
        p_alias: z
          .object({
            alias: z.string().min(1).max(160),
            canonical: z.string().min(1).max(160),
          })
          .parse(p.data),
      });
    } else if (p.action === "settings") {
      result = await client.rpc("save_planner_settings", {
        p_request: p.request,
        p_settings: z
          .object({
            cookingDays: z.number().int().min(0).max(14).optional(),
            batchPortions: z.number().int().min(1).max(100).optional(),
            sideVersion: z.string().uuid().optional(),
            budgetMinor: z.number().int().nonnegative().optional(),
            revision: z.number().int().nonnegative().optional(),
            persons: z.number().int().min(1).max(20),
            perDay: z.number().int().min(1).max(4),
            days: z.number().int().min(1).max(14),
            priority: z.enum(["variety", "favorites", "stock", "economic"]),
            banned: z.array(z.string().min(1).max(120)).max(30),
          })
          .parse(p.data),
      });
    } else if (p.action === "meals") {
      const changes = z
        .array(mealSchema.extend({ remove: z.boolean().optional() }))
        .max(150)
        .parse(p.data);
      result = await client.rpc("edit_meal_plan", {
        p_request: p.request,
        p_changes: changes,
      });
    } else if (p.action === "pantry")
      result = await client.rpc("save_pantry_item", {
        p_request: p.request,
        p_item: pantry.parse(p.data),
      });
    else
      result = await client.rpc("save_shopping_plan", {
        p_request: p.request,
        p_plan: (() => {
          const parsed = shopping.parse(p.data);
          return {
            ...parsed,
            recipes: parsed.recipes.sort((a, b) => a.id.localeCompare(b.id)),
            items: parsed.items.sort((a, b) => a.id.localeCompare(b.id)),
          };
        })(),
      });
    if (result.error) throw Error(result.error.message);
    return NextResponse.json(
      { ok: true, result: result.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message =
      e instanceof z.ZodError
        ? "Skontrolujte vyplnené údaje."
        : e instanceof Error
          ? e.message
          : "Operácia zlyhala.";
    return NextResponse.json(
      {
        error: message.includes("REVISION_CONFLICT")
          ? "Plán medzitým niekto zmenil. Obnovte stránku."
          : message,
      },
      { status: 400 },
    );
  }
}
