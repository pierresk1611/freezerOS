import { z } from "zod";
import specification from "../../docs/meal-prep-import.schema.json";
import { isMainRole } from "./meal-roles";
import { recipeSchema } from "./domain";
import { addDays, type Meal, type PlanRecipe } from "./planning";
export type PrepRecipe = {
  key: string;
  recipe: z.infer<typeof recipeSchema>;
  planned_portions: number;
  yield_g?: number;
  active_minutes?: number;
  allergens: string[];
  compatible_sides: string[];
  preservation: {
    cooling: string;
    freezing: string;
    vacuuming: string;
    thawing: string;
  };
  portioning: {
    mold_ml: number[];
    description: string;
    cubes_per_package?: number;
  };
  estimated_cost_minor?: number;
  notes?: string;
  source_url?: string;
};
export type PrepDocument = {
  format: "freezeros.mealprep.v1";
  importId: string;
  name: string;
  description: string;
  days: number;
  target_portions: number;
  cooking_date: string;
  recipes: PrepRecipe[];
  timeline: {
    key: string;
    label: string;
    start_minute: number;
    duration_minutes: number;
    recipe_keys: string[];
  }[];
  meal_plan?: {
    day_offset: number;
    slot: Meal["slot"];
    main: string;
    sides: string[];
    portions: number;
  }[];
};
// The published JSON Schema is the runtime validator's source, not a parallel hand-maintained schema.
export const prepSchema = z.fromJSONSchema(
  specification as Parameters<typeof z.fromJSONSchema>[0],
) as z.ZodType<PrepDocument>;
export function parsePrep(raw: unknown) {
  const doc = prepSchema.parse(raw);
  const keys = new Set<string>();
  for (const item of doc.recipes) {
    if (keys.has(item.key))
      throw Error(`recipes.${item.key}: duplicitný kľúč.`);
    keys.add(item.key);
    recipeSchema.parse(item.recipe);
    if (item.recipe.side_policy === "required" && !item.compatible_sides.length)
      throw Error(`${item.key}: chýba kompatibilná príloha.`);
  }
  for (const item of doc.recipes)
    for (const key of item.compatible_sides) {
      const side = doc.recipes.find((r) => r.key === key);
      if (
        !side ||
        !["side", "vegetable_side", "component"].includes(
          side.recipe.meal_role ?? "",
        )
      )
        throw Error(`${item.key}.compatible_sides: neplatná príloha ${key}.`);
    }
  const tasks = new Set<string>();
  for (const task of doc.timeline) {
    if (tasks.has(task.key)) throw Error("timeline: duplicitný kľúč činnosti.");
    tasks.add(task.key);
    for (const key of task.recipe_keys)
      if (!keys.has(key))
        throw Error(`timeline.${task.key}: neznámy recept ${key}.`);
  }
  for (const meal of doc.meal_plan ?? []) {
    if (meal.day_offset >= doc.days)
      throw Error("meal_plan: deň je mimo rozsahu projektu.");
    if (!keys.has(meal.main) || meal.sides.some((k) => !keys.has(k)))
      throw Error("meal_plan: neznámy recept.");
    if (new Set(meal.sides).size !== meal.sides.length)
      throw Error("meal_plan: duplicitná príloha.");
    const main = doc.recipes.find((r) => r.key === meal.main)!;
    if (
      !isMainRole(main.recipe.meal_role, meal.slot) ||
      !main.recipe.allowed_slots?.includes(meal.slot)
    )
      throw Error(
        `meal_plan.${meal.main}: recept nie je povolený ako samostatné jedlo v tomto slote.`,
      );
    if (
      meal.sides.length &&
      (main.recipe.meal_role !== "main" || main.recipe.side_policy === "none")
    )
      throw Error(`meal_plan.${meal.main}: recept nepovoľuje ďalšiu prílohu.`);
    if (main.recipe.side_policy === "required" && !meal.sides.length)
      throw Error(`meal_plan.${meal.main}: vyberte požadovanú prílohu.`);
    if (
      meal.sides.some(
        (key) =>
          !main.compatible_sides.includes(key) ||
          !doc.recipes
            .find((r) => r.key === key)!
            .recipe.allowed_slots?.includes(meal.slot),
      )
    )
      throw Error(
        `meal_plan.${meal.main}: nepotvrdená príloha alebo jej denný slot.`,
      );
  }
  return doc;
}
export function prepError(e: unknown) {
  return e instanceof z.ZodError
    ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n")
    : e instanceof Error
      ? e.message
      : typeof e === "object" &&
          e !== null &&
          "message" in e &&
          typeof e.message === "string"
        ? e.message
        : "Import zlyhal.";
}
export type ProjectRecipe = {
  id: string;
  local_key: string;
  recipe_version_id: string;
  portions: number;
  details: PrepRecipe | null;
};
export function prepChoices(rows: ProjectRecipe[]): PlanRecipe[] {
  return rows.map((r) => ({
    id: r.id,
    recipe_version_id: r.recipe_version_id,
    portions: r.portions,
    from_freezer: 0,
    meal_entry_id: null,
  }));
}
export function prepMeals(
  doc: PrepDocument,
  rows: ProjectRecipe[],
  uuid: () => string,
): Meal[] {
  return (doc.meal_plan ?? [])
    .filter(
      (m) =>
        rows.some((r) => r.local_key === m.main) &&
        m.sides.every((k) => rows.some((r) => r.local_key === k)),
    )
    .map((m) => ({
      id: uuid(),
      recipe_version_id: rows.find((r) => r.local_key === m.main)!
        .recipe_version_id,
      meal_date: addDays(doc.cooking_date, m.day_offset),
      slot: m.slot,
      portions: m.portions,
      components: m.sides.map((key) => ({
        recipe_version_id: rows.find((r) => r.local_key === key)!
          .recipe_version_id,
        portions: m.portions,
      })),
      origin: "manual",
    }));
}
export const prepPrompt = `Vytvor jeden platný JSON súbor pre FREEZER OS vo formáte freezeros.mealprep.v1 podľa priloženej oficiálnej schémy. Vráť JSON bez komentárov. Každému receptu daj stabilný lokálny key, úplné suroviny v g/ml/ks, porcie, celý postup, pravdivú meal_role a allowed_slots. Hlavné jedlo a prílohy sú samostatné recepty spojené pomocou compatible_sides a meal_plan.sides. Nedávaj prílohu ako samostatný obed či večeru. Zahrň harmonogram varenia, individuálne schladenie, mrazenie, vákuovanie, rozmrazovanie a ohrievanie. Odlišuj objem foriem od hmotnosti. Neznáme ceny, výživové hodnoty a výťažnosť vynechaj. Ceny uvádzaj iba ako odhady v celých halieroch CZK: estimated_cost_minor je celkový odhad pre planned_portions daného riadku. Alergény over podľa skutočných surovín a značiek; upozorni na neistotu. Nevydávaj všeobecných 90 dní za bezpečnostnú hranicu. Použi nové UUID importId; pri oprave toho istého súboru nevydávaj rozdielny obsah pod pôvodným ID. Obrázky sú voliteľné: len HTTPS zdroj s autorom a licenciou, žiadne vymyslené URL. Schéma: https://freezer-os.vercel.app/api/meal-preps/schema . Príklad: https://freezer-os.vercel.app/api/meal-preps/example .`;
export const prepStatuses = {
  planned: "Plánovaný",
  purchased: "Nakúpený",
  cooking: "Varím",
  cooked: "Uvarený",
  frozen: "Zamrazený",
} as const;
