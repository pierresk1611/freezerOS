import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { planningData } from "./planning-server";
import {
  pragueToday,
  shoppingRequirements,
  reconcileShopping,
  type ShoppingItem,
  type ShoppingPlan,
} from "./planning";
import {
  prepChoices,
  prepMeals,
  type ProjectRecipe,
  type PrepDocument,
} from "./meal-prep";
import { randomUUID } from "node:crypto";
import { normalizeName } from "./food-cost";
export const prepRowSchema = z.object({
  id: z.string().uuid(),
  local_key: z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/),
  recipe_version_id: z.string().uuid(),
  portions: z.number().positive().max(100),
});
export const prepUpdateSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  rows: z.array(prepRowSchema).min(1).max(50),
  status: z.enum(["planned", "purchased", "cooking", "cooked", "frozen"]),
  manual: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(160),
        unit: z.enum(["g", "ml", "ks"]),
        quantity: z.number().nonnegative().max(1e9),
        checked: z.boolean(),
      }),
    )
    .max(100),
  checks: z.record(z.string().uuid(), z.boolean()),
  receipt_id: z.string().uuid().nullable().optional(),
});
export async function loadPrep(client: SupabaseClient, id: string) {
  const project = await client
    .from("meal_prep_projects")
    .select("*")
    .eq("id", id)
    .single();
  if (project.error) throw Error("Meal-prep projekt nie je dostupný.");
  const [rows, header, items, links, calendar] = await Promise.all([
    client
      .from("meal_prep_project_recipes")
      .select("*")
      .eq("project_id", id)
      .order("id"),
    client
      .from("shopping_plans")
      .select("*")
      .eq("id", project.data.shopping_plan_id)
      .single(),
    client
      .from("shopping_plan_items")
      .select("*")
      .eq("plan_id", project.data.shopping_plan_id),
    client
      .from("shopping_receipt_links")
      .select("receipt_id")
      .eq("plan_id", project.data.shopping_plan_id),
    client
      .from("meal_prep_calendar_links")
      .select("entry_id")
      .eq("project_id", id),
  ]);
  for (const r of [rows, header, items, links, calendar])
    if (r.error) throw Error(r.error.message);
  return {
    project: project.data,
    rows: (rows.data ?? []).map((r) => ({
      ...r,
      portions: Number(r.portions),
    })) as ProjectRecipe[],
    plan: {
      ...header.data,
      receipt_id: links.data?.[0]?.receipt_id ?? null,
      items: (items.data ?? []).map((i) => ({
        ...i,
        quantity: Number(i.quantity),
        required: Number(i.required),
      })),
      recipes: [],
    } as ShoppingPlan,
    calendar: calendar.data ?? [],
  };
}
export async function prepUpdate(
  client: SupabaseClient,
  input: z.infer<typeof prepUpdateSchema>,
) {
  const state = await loadPrep(client, input.id);
  if (state.project.revision !== input.revision)
    throw Error("REVISION_CONFLICT");
  const { recipes } = await planningData();
  const [pantry, aliases] = await Promise.all([
    client.from("pantry_items").select("*"),
    client.from("ingredient_aliases").select("alias,canonical"),
  ]);
  for (const r of [pantry, aliases]) if (r.error) throw Error(r.error.message);
  const rows = input.rows.map((r) => ({
    ...r,
    details: state.rows.find((old) => old.id === r.id)?.details ?? null,
  }));
  const choices = prepChoices(rows);
  const oldItems: ShoppingItem[] = [
    ...state.plan.items
      .filter((i) => !i.manual)
      .map((i) => ({ ...i, checked: input.checks[i.id] ?? i.checked })),
    ...input.manual.map((i) => ({
      ...i,
      ingredient_key: normalizeName(i.name),
      manual: true,
      required: 0,
      origins: [],
      selection: null,
    })),
  ];
  const requirements = shoppingRequirements(
    choices,
    recipes,
    (pantry.data ?? []).map((p) => ({ ...p, quantity: Number(p.quantity) })),
    state.project.cooking_date > pragueToday()
      ? state.project.cooking_date
      : pragueToday(),
    Object.fromEntries((aliases.data ?? []).map((a) => [a.alias, a.canonical])),
  );
  const reconciled = reconcileShopping(requirements, oldItems, randomUUID);
  const plan = {
    ...state.plan,
    recipes: choices,
    items: reconciled.items,
    receipt_id:
      input.receipt_id === undefined ? state.plan.receipt_id : input.receipt_id,
  };
  return { state, rows, plan, conflicts: reconciled.conflicts };
}
export async function prepCalendar(client: SupabaseClient, id: string) {
  const state = await loadPrep(client, id);
  const meals = prepMeals(
    state.project.source as PrepDocument,
    state.rows,
    randomUUID,
  );
  const used = new Set(
    meals.flatMap((e) =>
      [e, ...(e.components ?? [])].map((p) => p.recipe_version_id),
    ),
  );
  const batches = Array.from(used).map((version) => ({
    id: randomUUID(),
    recipe_version_id: version,
    cooking_date: state.project.cooking_date,
    portions: state.rows
      .filter((r) => r.recipe_version_id === version)
      .reduce((s, r) => s + r.portions, 0),
  }));
  for (const e of meals) {
    e.planned_batch_id = batches.find(
      (b) => b.recipe_version_id === e.recipe_version_id,
    )!.id;
    for (const c of e.components ?? [])
      c.planned_batch_id = batches.find(
        (b) => b.recipe_version_id === c.recipe_version_id,
      )!.id;
  }
  const entries = await client
    .from("meal_plan_entries")
    .select("meal_date,slot");
  if (entries.error) throw Error(entries.error.message);
  const conflicts = meals
    .filter((m) =>
      entries.data?.some(
        (e) => e.meal_date === m.meal_date && e.slot === m.slot,
      ),
    )
    .map((m) => m.meal_date + " " + m.slot);
  return { state, meals, batches, conflicts };
}
