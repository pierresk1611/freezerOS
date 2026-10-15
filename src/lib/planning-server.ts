import { userDb } from "./supabase";
import { estimateRecipeCost } from "./food-cost";
import { recipeRecord } from "./recipes";
import { loadRecipePhotos } from "./recipe-photos";
import {
  softPreferenceScore,
  favoriteDefaults,
  combinationDefaults,
} from "./portioning";
export async function planningData() {
  const { client } = await userDb();
  const results = await Promise.all([
    client
      .from("purchase_price_history")
      .select("*")
      .order("receipt_date", { ascending: false }),
    client.from("recipe_versions").select("*"),
    client.from("recipes").select("id,archived"),
    client.from("food_preferences").select("*").maybeSingle(),
    client
      .from("inventory_packages")
      .select(
        "remaining_g,initial_g,portions,best_before,cooking_batches(recipe_version_id)",
      )
      .gt("remaining_g", 0),
    client
      .from("meal_logs")
      .select("name,created_at")
      .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString()),
  ]);
  for (const r of results) if (r.error) throw Error(r.error.message);
  const [prices, versions, roots, prefs, stock, recent] = results;
  const photos = await loadRecipePhotos(
    client,
    (roots.data ?? []).map((r) => r.id),
  );
  const recipes = (versions.data ?? []).map((row) => {
    const r = recipeRecord(row);
    return {
      id: r.id,
      recipe_id: r.recipe_id,
      name: r.name,
      portions: r.portions,
      ingredients: r.ingredients,
      meat: r.meat,
      meal_role: r.meal_role ?? "unknown",
      allowed_slots: r.allowed_slots ?? [],
      side_policy: r.side_policy ?? "none",
      compatible_side_ids: r.compatible_side_ids ?? [],
      prep_minutes: r.prep_minutes,
      estimated_cost_minor: (() => {
        const estimate = estimateRecipeCost(
          r.ingredients,
          (prices.data ?? [])
            .filter((p) => p.receipt_date)
            .map((p) => ({ ...p, date: p.receipt_date })),
        );
        return estimate.complete ? estimate.subtotal : undefined;
      })(),
      photo: photos.get(r.recipe_id)?.[0]?.thumbnail,
      preference: softPreferenceScore(
        r,
        prefs.data?.favorites ?? favoriteDefaults,
        prefs.data?.combinations ?? combinationDefaults,
      ),
    };
  });
  const latest = recipes.filter(
    (r) =>
      roots.data?.some((root) => root.id === r.recipe_id && !root.archived) &&
      !recipes.some(
        (other) =>
          other.recipe_id === r.recipe_id &&
          (versions.data ?? []).find((v) => v.id === other.id)!.version >
            (versions.data ?? []).find((v) => v.id === r.id)!.version,
      ),
  );
  const available: Record<string, number | null> = {};
  const known: Record<string, number> = {},
    quality: Record<string, string> = {};
  for (const p of stock.data ?? []) {
    const batch = Array.isArray(p.cooking_batches)
      ? p.cooking_batches[0]
      : p.cooking_batches;
    const root = recipes.find(
      (r) => r.id === batch?.recipe_version_id,
    )?.recipe_id;
    if (!root) continue;
    if (p.best_before && (!quality[root] || p.best_before < quality[root]))
      quality[root] = p.best_before;
    if (p.portions !== null)
      known[root] =
        (known[root] ?? 0) + (Number(p.portions) * p.remaining_g) / p.initial_g;
    available[root] = known[root] ?? null;
  }
  return {
    client,
    recipes,
    latest,
    available,
    quality,
    recent: (recent.data ?? []).map((m) => m.name),
  };
}
