import { z } from "zod";
import { imageReferenceSchema } from "./photo-rules";
export const ingredientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.number().positive().max(1000000),
  unit: z.enum(["g", "ml", "ks"]),
});
export const recipeSchema = z.object({
  name: z.string().trim().min(2).max(160),
  portions: z.number().int().positive().max(100),
  ingredients: z.array(ingredientSchema).min(1).max(100),
  steps: z.array(z.string().trim().min(1).max(2000)).min(1).max(100),
  reheating: z.string().trim().min(1).max(2000),
  storage: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .default("Rýchlo schlaďte. Rozmrazujte v chladničke a dôkladne prehrejte."),
  meat: z
    .enum(["none", "beef", "pork", "chicken", "other", "fish"])
    .default("none"),
  freezing: z.boolean().default(true),
  category: z.enum(["general", "slow_roasted_pulled_meat"]).optional(),
  cooking_method: z.enum(["oven", "stove", "slow_roast"]).optional(),
  prep_minutes: z.number().int().min(1).max(1440).optional(),
  cooking_minutes_min: z.number().int().min(1).max(2880).optional(),
  cooking_minutes_max: z.number().int().min(1).max(2880).optional(),
  oven_c: z.number().int().min(50).max(300).optional(),
});
export const importSchema = z.object({
  schemaVersion: z.literal("1.0"),
  importId: z.string().uuid(),
  importType: z.literal("recipes"),
  source: z.string().min(1).max(100),
  generatedAt: z.string().datetime(),
  payload: z
    .array(
      recipeSchema.extend({
        imageReferences: z.array(imageReferenceSchema).max(8).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export function nutrition(
  items: { grams: number; kcalPer100g: number | null }[],
) {
  if (items.length === 0 || items.some((i) => i.kcalPer100g === null))
    return null;
  return items.reduce((s, i) => s + (i.grams / 100) * i.kcalPer100g!, 0);
}
export function portionCost(totalMinor: number | null, portions: number) {
  if (!Number.isInteger(portions) || portions <= 0)
    throw new Error("Neplatné porcie");
  return totalMinor === null ? null : Math.round(totalMinor / portions);
}
export type Package = {
  id: string;
  name: string;
  remaining_g: number;
  initial_g: number;
  cost_minor: number | null;
  best_before: string | null;
  created_at: string;
  location_id: string | null;
};
export function recommend(
  packages: Package[],
  recent: string[],
  today: Date = new Date(),
  preferences: Record<string, number> = {},
) {
  return (
    packages
      .filter((p) => p.remaining_g > 0)
      .map((p) => {
        const days = p.best_before
          ? (Date.parse(p.best_before) - today.getTime()) / 86400000
          : 90;
        const urgency = Math.max(0, Math.min(1, 1 - days / 90));
        const repeats = recent.filter((n) => n === p.name).length;
        const preferred = (preferences[p.id] ?? 0) > 0;
        return {
          item: p,
          score:
            0.3 * urgency +
            0.25 / (1 + repeats) +
            0.2 * (preferences[p.id] ?? 0),
          reason:
            (preferred ? "Zohľadnené sú vaše obľúbené chute. " : "") +
            (repeats
              ? `Toto jedlo ste jedli ${repeats}× za posledných 14 dní. Zohľadnená je aj odporúčaná spotreba.`
              : "Za posledných 14 dní ste toto jedlo nejedli. Zohľadnená je aj odporúčaná spotreba."),
        };
      })
      .sort((a, b) => b.score - a.score)[0] ?? null
  );
}
export function money(minor: number | null) {
  return minor === null
    ? "Neznáma cena"
    : new Intl.NumberFormat("sk-SK", {
        style: "currency",
        currency: "CZK",
      }).format(minor / 100);
}

export function remainingValue(
  p: Pick<Package, "cost_minor" | "remaining_g" | "initial_g">,
) {
  return p.cost_minor === null
    ? null
    : p.cost_minor -
        Math.round(
          (p.cost_minor * (p.initial_g - p.remaining_g)) / p.initial_g,
        );
}

export function parseCzk(text: string): number | null {
  const input = text.trim();
  if (input === "") return null;
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(input);
  if (!match) throw new Error("Neplatná suma");
  const minor =
    BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (minor > 100000000n) throw new Error("Suma je príliš vysoká");
  return Number(minor);
}
