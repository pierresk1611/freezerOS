import { z } from "zod";
export const moldSchema = z.object({
  name: z.string().trim().min(1).max(100),
  cells: z.coerce.number().int().min(1).max(30),
  cell_ml: z.coerce.number().int().min(1).max(2000),
  owned_count: z.coerce.number().int().min(1).max(100),
});
export const cubeSchema = z.object({
  mold_id: z.string().uuid(),
  weight_g: z.number().int().min(1).max(1000000),
  volume_ml: z.number().int().min(1).max(2000),
});
export const packagePlanSchema = z
  .array(
    z.object({
      cubes: z.array(z.number().int().min(0)).min(1).max(200),
      portions: z
        .number()
        .min(0.01)
        .max(100)
        .refine(
          (n) => Number.isInteger(Math.round(n * 1000000) / 10000),
          "Najviac dve desatinné miesta",
        ),
      location_id: z.string().uuid().nullable(),
    }),
  )
  .min(1)
  .max(100);
export function balanceCubes(
  cubes: { weight_g: number; volume_ml: number }[],
  weight: number,
) {
  return {
    grams: cubes.reduce((s, c) => s + c.weight_g, 0),
    ml: cubes.reduce((s, c) => s + c.volume_ml, 0),
    valid:
      cubes.length > 0 && cubes.reduce((s, c) => s + c.weight_g, 0) === weight,
  };
}
export function allocateCosts(cost: number | null, weights: number[]) {
  if (
    !weights.length ||
    weights.some((w) => !Number.isInteger(w) || w <= 0) ||
    (cost !== null && (!Number.isSafeInteger(cost) || cost < 0))
  )
    throw new Error("Neplatná bilancia");
  const total = weights.reduce((a, b) => a + b, 0);
  let allocated = 0;
  return weights.map((w, i) => {
    if (cost === null) return null;
    const value =
      i === weights.length - 1
        ? cost - allocated
        : Number((BigInt(cost) * BigInt(w)) / BigInt(total));
    allocated += value;
    return value;
  });
}
export const favoriteDefaults = [
  "Trhané bravčové",
  "Trhané hovädzie",
  "Trhané kuracie",
  "Pomaly pečené mäso",
  "Šťavnaté mäso s bohatou šťavou",
  "Kukurica",
];
export const combinationDefaults = [
  "Mäso + jazmínová ryža",
  "Mäso + zemiaková kaša",
  "Trhané mäso + kukurica",
  "Trhané mäso + glazovaná mrkva",
];
export function softPreferenceScore(
  recipe: {
    meat?: string;
    category?: string;
    ingredients?: { name: string }[];
    name: string;
  },
  favorites: string[],
  combinations: string[],
) {
  let score = 0;
  const pulled = recipe.category === "slow_roasted_pulled_meat";
  const map: Record<string, string> = {
    pork: "bravčové",
    beef: "hovädzie",
    chicken: "kuracie",
  };
  const text =
    recipe.name.toLocaleLowerCase("sk") +
    " " +
    (recipe.ingredients ?? [])
      .map((i) => i.name)
      .join(" ")
      .toLocaleLowerCase("sk");
  for (const f of favorites) {
    const q = f.toLocaleLowerCase("sk");
    if (
      text.includes(q) ||
      (pulled && q === "pomaly pečené mäso") ||
      (pulled && q === "šťavnaté mäso s bohatou šťavou") ||
      (pulled && q === `trhané ${map[recipe.meat ?? ""]}`) ||
      (q === "kukurica" && text.includes("kukuric"))
    )
      score++;
  }
  for (const c of combinations) {
    if (
      (c.includes("jazmínová ryža") && text.includes("jazmínov")) ||
      (c.includes("zemiaková kaša") && text.includes("kaš")) ||
      (pulled && c.includes("kukurica") && text.includes("kukuric")) ||
      (pulled && c.includes("glazovaná mrkva") && text.includes("glazovan"))
    )
      score++;
  }
  return Math.min(1, score / 4);
}
