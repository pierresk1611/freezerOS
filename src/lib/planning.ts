import { z } from "zod";
import { normalizeName } from "./food-cost";
export const slots = {
  breakfast: "Raňajky",
  lunch: "Obed",
  dinner: "Večera",
  snack: "Snack",
} as const;
export const daySchema = z.iso.date();
export function pragueToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function addDays(day: string, n: number) {
  daySchema.parse(day);
  return new Date(Date.parse(day + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function monday(day: string) {
  daySchema.parse(day);
  const d = new Date(day + "T12:00:00Z").getUTCDay();
  return addDays(day, -((d + 6) % 7));
}
export const mealSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative().optional(),
  recipe_version_id: z.string().uuid(),
  meal_date: daySchema,
  slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  ready_portions: z.number().nonnegative().max(100).optional(),
  batch_portions: z.number().nonnegative().max(100).optional(),
  portions: z.number().positive().max(100),
});
export type Meal = z.infer<typeof mealSchema>;
export type PlanningRecipe = {
  id: string;
  recipe_id: string;
  name: string;
  portions: number;
  ingredients: { name: string; quantity: number; unit: "g" | "ml" | "ks" }[];
  meat?: string;
  prep_minutes?: number;
  estimated_cost_minor?: number;
  photo?: string;
  preference?: number;
};
export type Pantry = {
  id: string;
  revision?: number;
  name: string;
  ingredient_key: string;
  quantity: number;
  unit: "g" | "ml" | "ks";
  expires_on: string | null;
  purchased_on?: string | null;
  location?: string;
  cost_minor?: number | null;
};
export type PlanRecipe = {
  id: string;
  recipe_version_id: string;
  portions: number;
  from_freezer: number;
  meal_entry_id: string | null;
};
export type ShoppingItem = {
  id: string;
  ingredient_key: string;
  name: string;
  unit: "g" | "ml" | "ks";
  required: number;
  quantity: number;
  manual: boolean;
  checked: boolean;
  origins: { recipe_version_id: string; quantity: number }[];
  selection: Record<string, unknown> | null;
};
export type ShoppingPlan = {
  calendar_changes?: Meal[];
  id: string;
  revision?: number;
  name: string;
  status:
    | "draft"
    | "ready"
    | "exported"
    | "partially_purchased"
    | "purchased"
    | "closed"
    | "cancelled";
  recipes: PlanRecipe[];
  items: ShoppingItem[];
  receipt_id?: string | null;
};
const round = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
// Units never cross dimensions. Aliases only originate from explicit user mapping.
export function shoppingRequirements(
  choices: PlanRecipe[],
  recipes: PlanningRecipe[],
  pantry: Pantry[],
  today: string,
  aliases: Record<string, string> = {},
) {
  const map = new Map<
    string,
    Omit<ShoppingItem, "id" | "checked" | "manual" | "selection">
  >();
  for (const c of choices) {
    const r = recipes.find((r) => r.id === c.recipe_version_id);
    if (!r) throw Error("Receptová verzia nie je dostupná.");
    if (c.from_freezer < 0 || c.from_freezer > c.portions)
      throw Error("Neplatná alokácia mrazničky.");
    for (const i of r.ingredients) {
      const key = aliases[normalizeName(i.name)] ?? normalizeName(i.name),
        id = key + "|" + i.unit,
        q = (i.quantity * (c.portions - c.from_freezer)) / r.portions;
      const item = map.get(id) ?? {
        ingredient_key: key,
        name: i.name,
        unit: i.unit,
        required: 0,
        quantity: 0,
        origins: [],
      };
      item.required = round(item.required + q);
      item.origins.push({ recipe_version_id: r.id, quantity: round(q) });
      map.set(id, item);
    }
  }
  return [...map.values()]
    .filter((i) => i.required > 0)
    .map((i) => {
      const available = pantry
        .filter(
          (p) =>
            (aliases[p.ingredient_key] ?? p.ingredient_key) ===
              i.ingredient_key &&
            p.unit === i.unit &&
            (!p.expires_on || p.expires_on >= today),
        )
        .reduce((s, p) => s + Number(p.quantity), 0);
      return { ...i, quantity: round(Math.max(0, i.required - available)) };
    });
}
export function reconcileShopping(
  requirements: ReturnType<typeof shoppingRequirements>,
  old: ShoppingItem[],
  uuid: () => string,
) {
  const items: ShoppingItem[] = old
    .filter((i) => i.manual)
    .map((i) => ({ ...i }));
  const conflicts: string[] = [];
  for (const r of requirements) {
    const previous = old.find(
      (i) =>
        !i.manual && i.ingredient_key === r.ingredient_key && i.unit === r.unit,
    );
    const changed = previous && previous.required !== r.required;
    if (changed && previous.selection)
      conflicts.push(`${r.name}: skontrolujte zvolené balenie.`);
    items.push({
      ...r,
      id: previous?.id ?? uuid(),
      manual: false,
      checked: previous?.checked ?? false,
      selection: previous?.selection ?? null,
      quantity:
        previous?.selection?.quantity_override === true
          ? previous.quantity
          : r.quantity,
    });
  }
  for (const removed of old.filter(
    (i) =>
      !i.manual &&
      !requirements.some(
        (r) => r.ingredient_key === i.ingredient_key && r.unit === i.unit,
      ),
  )) {
    if (removed.checked || removed.selection) {
      items.push({ ...removed, required: 0, origins: [] });
      conflicts.push(
        `${removed.name}: požiadavka zanikla; ponechaný potvrdený výber.`,
      );
    }
  }
  return { items, conflicts };
}
export function packagesNeeded(required: number, size: number, minimum = 1) {
  if (
    !Number.isFinite(required) ||
    !Number.isFinite(size) ||
    !Number.isInteger(minimum) ||
    required < 0 ||
    size <= 0 ||
    minimum < 1
  )
    throw Error("Neplatné balenie");
  const count =
    required === 0 ? 0 : Math.max(minimum, Math.ceil(required / size));
  return { count, excess: round(count * size - required) };
}
export function generateMeals(
  recipes: PlanningRecipe[],
  start: string,
  days: number,
  persons: number,
  perDay: number,
  existing: Meal[],
  recent: string[],
  banned: string[],
  uuid: () => string,
  options?: {
    available?: Record<string, number | null>;
    cookingDays?: number;
    batchPortions?: number;
    sideVersion?: string;
    budgetMinor?: number;
    economic?: boolean;
    quality?: Record<string, string>;
  },
) {
  const allowed = recipes.filter(
    (r) =>
      !banned.some((b) =>
        normalizeName(
          r.name +
            " " +
            ({
              fish: "ryba ryby",
              beef: "hovädzie",
              pork: "bravčové",
              chicken: "kuracie",
            }[r.meat ?? ""] ?? "") +
            " " +
            r.ingredients.map((i) => i.name).join(" "),
        ).includes(normalizeName(b)),
      ),
  );
  if (!allowed.length) throw Error("Žiadny recept nespĺňa tvrdé obmedzenia.");
  const result: Meal[] = [];
  const counts = new Map<string, number>();
  existing.forEach((e) =>
    counts.set(e.recipe_version_id, (counts.get(e.recipe_version_id) ?? 0) + 1),
  );
  const remaining = { ...options?.available };
  for (const entry of existing) {
    const root = recipes.find(
      (r) => r.id === entry.recipe_version_id,
    )?.recipe_id;
    if (root && remaining[root] !== null && remaining[root] !== undefined)
      remaining[root] = Math.max(
        0,
        Number(remaining[root]) - Number(entry.ready_portions ?? 0),
      );
  }
  for (let d = 0; d < days; d++)
    for (let s = 0; s < perDay; s++) {
      const last = result
        .slice(-3)
        .map((e) => allowed.find((r) => r.id === e.recipe_version_id)?.meat);
      const readyDay =
        options?.cookingDays !== undefined && d >= options.cookingDays;
      const candidates = readyDay
        ? allowed.filter((r) => (remaining[r.recipe_id] ?? 0) >= persons)
        : allowed;
      if (!candidates.length)
        throw Error(
          "Na dni s hotovým jedlom nie je dosť preukázaných porcií. Znížte ich počet alebo zvýšte počet dní varenia.",
        );
      const sorted = [...candidates].sort((a, b) => score(b) - score(a));
      function score(r: PlanningRecipe) {
        return (
          (r.preference ?? 0) +
          (options?.economic && r.estimated_cost_minor !== undefined
            ? 3 / (1 + r.estimated_cost_minor / r.portions / 100)
            : 0) +
          (options?.quality?.[r.recipe_id]
            ? Math.max(
                0,
                2 -
                  (Date.parse(options.quality[r.recipe_id]) -
                    Date.parse(start)) /
                    86400000 /
                    30,
              )
            : 0) -
          (counts.get(r.id) ?? 0) * 3 -
          recent.filter((n) => n === r.name).length -
          (last.length === 3 && last.every((m) => m === r.meat) ? 4 : 0)
        );
      }
      const r = sorted[0];
      counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
      result.push({
        id: uuid(),
        recipe_version_id: r.id,
        meal_date: addDays(start, d),
        slot: (["lunch", "dinner", "breakfast", "snack"] as const)[s],
        portions: persons,
        ready_portions: readyDay ? persons : 0,
        batch_portions: readyDay
          ? 0
          : Math.max(persons, options?.batchPortions ?? persons),
      });
      if (readyDay)
        remaining[r.recipe_id] = Number(remaining[r.recipe_id]) - persons;
      if (options?.sideVersion) {
        const side = allowed.find((x) => x.id === options.sideVersion);
        if (!side) throw Error("Príloha nespĺňa tvrdé obmedzenia.");
        if (side.id !== r.id) {
          if (readyDay && Number(remaining[side.recipe_id] ?? 0) < persons)
            throw Error("Na hotový deň chýbajú preukázané porcie prílohy.");
          result.push({
            id: uuid(),
            recipe_version_id: side.id,
            meal_date: addDays(start, d),
            slot: (["lunch", "dinner", "breakfast", "snack"] as const)[s],
            portions: persons,
            ready_portions: readyDay ? persons : 0,
          });
          if (readyDay)
            remaining[side.recipe_id] =
              Number(remaining[side.recipe_id]) - persons;
        }
      }
    }
  if (options?.budgetMinor !== undefined) {
    const estimates = result.map((e) => {
      const r = allowed.find((r) => r.id === e.recipe_version_id)!;
      return r.estimated_cost_minor === undefined
        ? null
        : Math.round(
            (r.estimated_cost_minor *
              (e.ready_portions ? 0 : e.batch_portions || e.portions)) /
              r.portions,
          );
    });
    if (
      estimates.every((n) => n !== null) &&
      estimates.reduce((s, n) => s + Number(n), 0) > options.budgetMinor
    )
      throw Error(
        "Návrh prekračuje zadaný orientačný rozpočet. Zmeňte recepty, počet porcií alebo rozpočet.",
      );
  }
  return result;
}
export function shoppingText(p: ShoppingPlan) {
  return (
    `${p.name}\n` +
    p.items
      .map(
        (i) =>
          `${i.checked ? "[x]" : "[ ]"} ${i.name}: ${i.quantity} ${i.unit}`,
      )
      .join("\n")
  );
}
export function shoppingCsv(p: ShoppingPlan) {
  const cell = (s: string) => '"' + s.replaceAll('"', '""') + '"';
  return (
    "\uFEFFNázov;Množstvo;Jednotka;Nakúpené\r\n" +
    p.items
      .map((i) =>
        [
          cell(/^[=+@-]/.test(i.name) ? "'" + i.name : i.name),
          i.quantity,
          i.unit,
          i.checked ? "áno" : "nie",
        ].join(";"),
      )
      .join("\r\n")
  );
}

export function rohlikShoppingTask(
  plan: ShoppingPlan,
  generatedAt = new Date().toISOString(),
) {
  return {
    format: "freezer.shopping-task",
    schemaVersion: "1.0",
    generatedAt,
    source: "FREEZER OS",
    connection: "not_connected",
    plan: {
      id: plan.id,
      revision: plan.revision ?? null,
      name: plan.name,
      status: plan.status,
    },
    instructions:
      "Vyhledej vhodné produkty přes oficiální Rohlík MCP připojený v tomto chatu. Nejprve ukaž balení, cenu, dostupnost a návrh rozdílů vůči aktuálnímu košíku. Vyžádej si výslovné potvrzení před jakoukoliv změnou. Stávající osobní položky nemaž. Objednávku neodesílej ani neplať.",
    constraints: {
      preserveExistingCart: true,
      requireProductConfirmation: true,
      requireCartDiffConfirmation: true,
      allowCheckout: false,
      allowPayment: false,
      skipPurchased: true,
    },
    recipes: plan.recipes.map((r) => ({
      recipeVersionId: r.recipe_version_id,
      plannedPortions: r.portions,
      fromFreezer: r.from_freezer,
    })),
    items: plan.items
      .filter((i) => !i.checked && i.quantity > 0)
      .map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        manual: i.manual,
        productId: null,
        currentPriceMinor: null,
        availability: null,
        packQuantity:
          typeof i.selection?.pack_quantity === "number"
            ? i.selection.pack_quantity
            : null,
        minimumPacks:
          typeof i.selection?.minimum_pack_count === "number"
            ? i.selection.minimum_pack_count
            : 1,
        origins: i.origins,
      })),
    notice:
      "Jde o zadání k ověření, nikoliv vytvořený košík nebo zaplacenou objednávku. Připojení Rohlíka v ChatGPT neautorizuje FREEZER OS.",
  };
}
