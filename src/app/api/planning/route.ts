import { db } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { roleSchema, slotSchema } from "@/lib/meal-roles";
import { mealSchema } from "@/lib/planning";
const requestSchema = z.object({
  request: z.string().uuid(),
  action: z.enum([
    "meals",
    "schedule",
    "roles",
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
    let roleVersions: { id: string; recipe_id: string }[] | undefined;
    if (p.action === "roles") {
      const rows = z
        .array(
          z.object({
            version_id: z.string().uuid(),
            meal_role: roleSchema,
            allowed_slots: z.array(slotSchema).min(1).max(4),
            side_policy: z.enum(["none", "optional", "required"]),
            compatible_side_ids: z.array(z.string().uuid()).max(30),
          }),
        )
        .min(1)
        .max(100)
        .parse(p.data);
      result = await client.rpc("classify_recipe_roles", {
        p_request: p.request,
        p_rows: rows,
      });
      if (!result.error) {
        const latest = await client
          .from("recipe_latest")
          .select("id,recipe_id");
        if (latest.error) throw Error(latest.error.message);
        roleVersions = latest.data;
      }
    } else if (p.action === "schedule") {
      const data = z
        .object({
          changes: z
            .array(mealSchema.extend({ remove: z.boolean().optional() }))
            .max(150),
          batches: z
            .array(
              z.object({
                id: z.string().uuid(),
                revision: z.number().int().nonnegative().optional(),
                recipe_version_id: z.string().uuid(),
                cooking_date: z.iso.date(),
                portions: z.number().positive().max(100),
              }),
            )
            .max(150),
          automatic: z.boolean(),
        })
        .parse(p.data);
      result = await client.rpc("save_meal_schedule", {
        p_request: p.request,
        p_changes: data.changes,
        p_batches: data.batches,
        p_automatic: data.automatic,
      });
    } else if (p.action === "receive") {
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
      { ok: true, result: result.data, roleVersions },
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
          : message.includes("LINKED_SHOPPING")
            ? "Jedlo je spojené s nákupom. Vymeňte recept pri zachovaní záznamu; nákup zostane na kontrolu."
            : message.includes("GROUPED_MEAL")
              ? "Kombinované jedlo upravte v jedálničku. Nákup synchronizujte až po kontrole."
              : message.includes("Insufficient known freezer")
                ? "Na tento týždeň nemáte dosť preukázaných hotových porcií. Upravte zdroj jedla."
                : message.includes("overallocated")
                  ? "Plánovaná várka nepokryje všetky jedlá. Zväčšite várku alebo upravte porcie."
                  : message.includes("Side required")
                    ? "Toto hlavné jedlo vyžaduje potvrdenú prílohu."
                    : message.includes("Invalid planned batch") ||
                        message.includes("Invalid linked batch") ||
                        message.includes("Invalid side batch")
                      ? "Várka musí patriť rovnakému receptu a byť pripravená najneskôr v deň konzumácie."
                      : message.includes("PGRST202")
                        ? "Najprv aktivujte migráciu 010. Nič nebolo uložené."
                        : message,
      },
      { status: 400 },
    );
  }
}
