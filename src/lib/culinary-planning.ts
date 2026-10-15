import { normalizeName } from "./food-cost";
import { isMainRole, isSideRole } from "./meal-roles";
import {
  addDays,
  type Meal,
  type PlannedBatch,
  type PlanningRecipe,
  type PlanRecipe,
} from "./planning";
export type Schedule = {
  entries: Meal[];
  batches: PlannedBatch[];
  warnings: string[];
};
export function eligibleMain(r: PlanningRecipe, slot: string) {
  return isMainRole(r.meal_role, slot) && !!r.allowed_slots?.includes(slot);
}
export function compatibleSides(
  main: PlanningRecipe,
  recipes: PlanningRecipe[],
  slot: string,
) {
  return main.meal_role === "main" && main.side_policy !== "none"
    ? recipes.filter(
        (r) =>
          r.recipe_id !== main.recipe_id &&
          isSideRole(r.meal_role) &&
          r.allowed_slots?.includes(slot) &&
          main.compatible_side_ids?.includes(r.recipe_id),
      )
    : [];
}
export function respectsBans(r: PlanningRecipe, banned: string[]) {
  const text = normalizeName(
    r.name +
      " " +
      (r.meat ?? "") +
      " " +
      ({
        beef: "hovädzie",
        pork: "bravčové",
        chicken: "kuracie",
        fish: "ryba ryby",
      }[r.meat ?? ""] ?? "") +
      " " +
      r.ingredients.map((i) => i.name).join(" "),
  );
  return !banned
    .map(normalizeName)
    .filter(Boolean)
    .some((b) => text.includes(b));
}
export function batchUsage(id: string, entries: Meal[]) {
  return entries.reduce(
    (s, e) =>
      s +
      (e.planned_batch_id === id ? e.portions - (e.ready_portions ?? 0) : 0) +
      (e.components ?? [])
        .filter((c) => c.planned_batch_id === id)
        .reduce((n, c) => n + c.portions - (c.ready_portions ?? 0), 0),
    0,
  );
}
export function validateSchedule(
  entries: Meal[],
  batches: PlannedBatch[],
  recipes: PlanningRecipe[],
) {
  for (const e of entries) {
    const r = recipes.find((r) => r.id === e.recipe_version_id);
    if (!r) throw Error("Recept nie je dostupný.");
    const roots = new Set([r.recipe_id]);
    for (const c of e.components ?? []) {
      const side = recipes.find((r) => r.id === c.recipe_version_id);
      if (
        !side ||
        roots.has(side.recipe_id) ||
        !compatibleSides(r, recipes, e.slot).some((s) => s.id === side.id)
      )
        throw Error("Príloha nie je potvrdená ako kompatibilná.");
      roots.add(side.recipe_id);
    }
    for (const part of [e, ...(e.components ?? [])]) {
      if (
        part.ready_portions !== undefined &&
        (part.ready_portions < 0 || part.ready_portions > part.portions)
      )
        throw Error("Neplatné hotové porcie.");
      if (part.planned_batch_id) {
        const b = batches.find((b) => b.id === part.planned_batch_id);
        if (
          !b ||
          b.recipe_version_id !== part.recipe_version_id ||
          b.cooking_date > e.meal_date
        )
          throw Error("Neplatná plánovaná várka.");
      }
    }
  }
  for (const b of batches)
    if (batchUsage(b.id, entries) > b.portions + 1e-8)
      throw Error("Várka nemá dostatok porcií.");
}
export function generateSchedule(
  recipes: PlanningRecipe[],
  start: string,
  days: number,
  persons: number,
  perDay: number,
  existing: Meal[],
  recent: string[],
  banned: string[],
  uuid: () => string,
  options: {
    mainCandidates?: string[];
    available?: Record<string, number | null>;
    batchPortions?: number;
    cookingDays?: number;
    includeSides?: boolean;
    sideVersion?: string;
    economic?: boolean;
    budgetMinor?: number;
    quality?: Record<string, string>;
    existingBatches?: PlannedBatch[];
  } = {},
): Schedule {
  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > 14 ||
    persons <= 0 ||
    persons > 100 ||
    !Number.isInteger(perDay) ||
    perDay < 1 ||
    perDay > 4
  )
    throw Error("Skontrolujte rozsah plánu a porcie.");
  const allowed = recipes.filter((r) => respectsBans(r, banned));
  const entries: Meal[] = [],
    batches: PlannedBatch[] = [];
  const warnings: string[] = [];
  const cookingDays = options.cookingDays ?? 2,
    yieldPortions = Math.max(persons, options.batchPortions ?? 6);
  if (cookingDays < 0 || cookingDays > days || yieldPortions > 100)
    throw Error("Neplatné plánovanie várok.");
  const cookDates = Array.from({ length: cookingDays }, (_, i) =>
    addDays(start, i === 0 ? -1 : Math.floor((i * days) / cookingDays)),
  );
  const remaining = { ...options.available };
  for (const e of existing)
    for (const part of [e, ...(e.components ?? [])]) {
      const root = recipes.find(
        (r) => r.id === part.recipe_version_id,
      )?.recipe_id;
      if (root && typeof remaining[root] === "number")
        remaining[root] = Math.max(
          0,
          Number(remaining[root]) - Number(part.ready_portions ?? 0),
        );
    }
  const counts = new Map<string, number>();
  existing.forEach((e) =>
    counts.set(e.recipe_version_id, (counts.get(e.recipe_version_id) ?? 0) + 1),
  );
  function source(
    r: PlanningRecipe,
    day: string,
  ): { ready_portions: number; planned_batch_id: string | null } {
    const ready = Math.min(
      persons,
      Math.max(0, Number(remaining[r.recipe_id] ?? 0)),
    );
    remaining[r.recipe_id] = Number(remaining[r.recipe_id] ?? 0) - ready;
    if (ready === persons)
      return { ready_portions: ready, planned_batch_id: null };
    const required = persons - ready;
    let batch = batches.find(
      (b) =>
        b.recipe_version_id === r.id &&
        b.cooking_date <= day &&
        batchUsage(b.id, entries) + required <= b.portions,
    );
    if (!batch) {
      const cooking_date = cookDates.filter((d) => d <= day).at(-1);
      if (!cooking_date)
        throw Error(
          "Na plán nemáte dosť hotových porcií. Povoľte deň varenia.",
        );
      batch = {
        id: uuid(),
        recipe_version_id: r.id,
        cooking_date,
        portions: yieldPortions,
      };
      batches.push(batch);
    }
    return { ready_portions: ready, planned_batch_id: batch.id };
  }
  const daySlots = (["lunch", "dinner", "breakfast", "snack"] as const).slice(
    0,
    perDay,
  );
  for (let d = 0; d < days; d++)
    for (const slot of daySlots) {
      const day = addDays(start, d);
      if (existing.some((e) => e.meal_date === day && e.slot === slot))
        continue;
      const candidates = allowed.filter(
        (r) =>
          eligibleMain(r, slot) &&
          (!options.mainCandidates?.length ||
            options.mainCandidates.includes(r.id)),
      );
      if (!candidates.length)
        throw Error(
          `Pre ${slot === "lunch" ? "obed" : slot === "dinner" ? "večeru" : slot === "breakfast" ? "raňajky" : "snack"} chýba zatriedený recept. Najprv potvrďte roly receptov.`,
        );
      const sorted = [...candidates].sort((a, b) => score(b) - score(a));
      function score(r: PlanningRecipe) {
        const canReuse = batches.some(
          (b) =>
            b.recipe_version_id === r.id &&
            batchUsage(b.id, entries) + persons <= b.portions,
        );
        const ready = Number(remaining[r.recipe_id] ?? 0) >= persons;
        const urgency = options.quality?.[r.recipe_id]
          ? Math.max(
              0,
              2 -
                (Date.parse(options.quality[r.recipe_id]) - Date.parse(start)) /
                  86400000 /
                  30,
            )
          : 0;
        return (
          (r.preference ?? 0) +
          (ready ? 5 + urgency : 0) +
          (canReuse ? 4 : 0) -
          (counts.get(r.id) ?? 0) * 0.7 -
          recent.filter((n) => n === r.name).length +
          (options.economic && r.estimated_cost_minor !== undefined
            ? 2 / (1 + r.estimated_cost_minor / r.portions / 100)
            : 0)
        );
      }
      const main = sorted[0];
      counts.set(main.id, (counts.get(main.id) ?? 0) + 1);
      const entry: Meal = {
        id: uuid(),
        recipe_version_id: main.id,
        meal_date: day,
        slot,
        portions: persons,
        origin: "generated",
        components: [],
        ...source(main, day),
      };
      entries.push(entry);
      const sides = compatibleSides(main, allowed, slot);
      const side = options.sideVersion
        ? sides.find((s) => s.id === options.sideVersion)
        : sides[0];
      if (main.meal_role === "main" && main.side_policy === "required" && !side)
        throw Error(
          `Recept ${main.name} potrebuje potvrdenú kompatibilnú prílohu.`,
        );
      if (
        (options.includeSides ||
          options.sideVersion ||
          main.side_policy === "required") &&
        side
      )
        entry.components!.push({
          recipe_version_id: side.id,
          portions: persons,
          ...source(side, day),
        });
    }
  validateSchedule(
    [...existing, ...entries],
    [...(options.existingBatches ?? []), ...batches],
    recipes,
  );
  if (options.budgetMinor !== undefined) {
    const cooking = batches.map((b) => {
      const r = recipes.find((r) => r.id === b.recipe_version_id)!;
      return r.estimated_cost_minor === undefined
        ? null
        : Math.round((r.estimated_cost_minor * b.portions) / r.portions);
    });
    if (cooking.some((c) => c === null))
      warnings.push("Rozpočet nemožno overiť: niektoré ceny chýbajú.");
    else if (
      cooking.reduce<number>((s, c) => s + Number(c), 0) > options.budgetMinor
    )
      warnings.push(
        "Orientačná cena várok prekračuje rozpočet. Upravte návrh pred potvrdením.",
      );
  }
  return { entries, batches, warnings };
}
// Each planned cooking batch contributes its yield once, regardless of how many meals use it.
export function shoppingFromMeals(
  entries: Meal[],
  batches: PlannedBatch[],
  uuid: () => string,
): PlanRecipe[] {
  const result: PlanRecipe[] = [];
  const seen = new Set<string>();
  for (const e of entries)
    for (const [index, part] of [e, ...(e.components ?? [])].entries()) {
      if (part.planned_batch_id) {
        if (seen.has(part.planned_batch_id)) continue;
        const b = batches.find((b) => b.id === part.planned_batch_id);
        if (!b)
          throw Error("Načítajte plánované várky pred vytvorením nákupu.");
        seen.add(b.id);
        result.push({
          id: uuid(),
          recipe_version_id: b.recipe_version_id,
          portions: b.portions,
          from_freezer: 0,
          meal_entry_id: e.id,
        });
      } else {
        const legacy = Math.max(
          part.portions,
          index === 0 ? Number(e.batch_portions ?? 0) : 0,
        );
        result.push({
          id: uuid(),
          recipe_version_id: part.recipe_version_id,
          portions: legacy,
          from_freezer: part.ready_portions ?? 0,
          meal_entry_id: e.id,
        });
      }
    }
  return result;
}
export function proposalChanges(
  proposal: Schedule,
  current: Meal[],
  mode: "fill" | "selected" | "replace",
  selected: string[],
  uuid: () => string,
) {
  const bySlot = new Map<string, Meal[]>();
  for (const e of current) {
    const key = e.meal_date + "|" + e.slot;
    bySlot.set(key, [...(bySlot.get(key) ?? []), e]);
  }
  const used = new Set<string>();
  const changes: Meal[] = [];
  for (const generated of proposal.entries) {
    const key = generated.meal_date + "|" + generated.slot;
    const targets = bySlot.get(key) ?? [];
    if (mode === "fill" && targets.length) continue;
    const target = targets.find(
      (t) => !used.has(t.id) && (mode === "replace" || selected.includes(t.id)),
    );
    if (mode === "selected" && !target) continue;
    if (target) {
      used.add(target.id);
      changes.push({ ...generated, id: target.id, revision: target.revision });
    } else changes.push({ ...generated, id: generated.id || uuid() });
  }
  if (mode === "replace")
    for (const e of current)
      if (!used.has(e.id)) changes.push({ ...e, remove: true } as Meal);
  return changes;
}
