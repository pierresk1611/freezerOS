import { planningData } from "@/lib/planning-server";
import { addDays, daySchema } from "@/lib/planning";
import Shopping from "./shopping";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const p = await searchParams;
  const { client, recipes, latest, available } = await planningData();
  const [
    plans,
    choices,
    items,
    pantry,
    receipts,
    entries,
    aliases,
    allEntries,
  ] = await Promise.all([
    client
      .from("shopping_plans")
      .select("*,shopping_receipt_links(receipt_id)")
      .order("created_at", { ascending: false }),
    client.from("shopping_plan_recipes").select("*"),
    client.from("shopping_plan_items").select("*"),
    client.from("pantry_items").select("*"),
    client
      .from("purchase_receipts")
      .select(
        "id,total_minor,receipt_date,purchase_receipt_items(id,name,ingredient_name,quantity,unit,category,total_minor)",
      )
      .eq("status", "confirmed"),
    daySchema.safeParse(p.week).success
      ? client
          .from("meal_plan_entries")
          .select("*")
          .gte("meal_date", p.week!)
          .lte("meal_date", addDays(p.week!, 6))
      : Promise.resolve({ data: [], error: null }),
    client.from("ingredient_aliases").select("alias,canonical"),
    client.from("meal_plan_entries").select("*"),
  ]);
  if (plans.error || pantry.error)
    return (
      <section className="card">
        <h1>Nákupy</h1>
        <p>
          Pre nákupný engine aktivujte migráciu 009. Existujúce účtenky
          zostávajú vo Food Cost.
        </p>
      </section>
    );
  for (const r of [choices, items, receipts, entries, aliases, allEntries])
    if (r.error) throw Error(r.error.message);
  const [components, batches] = await Promise.all([
    client.from("meal_plan_components").select("*").order("position"),
    client.from("planned_cooking_batches").select("*"),
  ]);
  const withComponents = (rows: typeof entries.data) =>
    (rows ?? []).map((e) => ({
      ...e,
      components: (components.data ?? []).filter((c) => c.entry_id === e.id),
    }));
  return (
    <Shopping
      recipes={recipes}
      latest={latest}
      available={available}
      initialPlans={(plans.data ?? []).map((p) => ({
        ...p,
        receipt_id: p.shopping_receipt_links?.[0]?.receipt_id ?? null,
        recipes: (choices.data ?? [])
          .filter((r) => r.plan_id === p.id)
          .map((r) => ({
            id: r.id,
            recipe_version_id: r.recipe_version_id,
            portions: Number(r.portions),
            from_freezer: Number(r.from_freezer),
            meal_entry_id: r.meal_entry_id,
          })),
        items: (items.data ?? [])
          .filter((i) => i.plan_id === p.id)
          .map((i) => ({
            ...i,
            quantity: Number(i.quantity),
            required: Number(i.required),
          })),
      }))}
      pantry={(pantry.data ?? []).map((i) => ({
        ...i,
        quantity: Number(i.quantity),
      }))}
      receipts={receipts.data ?? []}
      weekEntries={withComponents(entries.data)}
      batches={batches.data ?? []}
      mealEntries={withComponents(allEntries.data)}
      aliases={Object.fromEntries(
        (aliases.data ?? []).map((a) => [a.alias, a.canonical]),
      )}
    />
  );
}
