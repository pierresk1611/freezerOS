import seed from "../../docs/seed-recipes.json";
import pulled from "../../docs/pulled-recipes.json";
import type { MealRole } from "./meal-roles";
// Curated template mapping, never a classifier inferred from arbitrary recipe names.
const roles: MealRole[] = [
  "main",
  "main",
  "main",
  "main",
  "main",
  "main",
  "main",
  "side",
  "side",
  "vegetable_side",
  "vegetable_side",
  "side",
  "side",
  "side",
  "complete",
  "main",
  "main",
  "main",
  "main",
];
type Content = {
  portions: number;
  ingredients: { name: string; quantity: number; unit: string }[];
  steps: unknown;
  meat?: string;
};
export function templateFingerprint(r: Content) {
  return JSON.stringify([
    r.portions,
    r.ingredients.map((i) => [i.name, i.quantity, i.unit]),
    r.steps,
    r.meat,
  ]);
}
export function roleProposal(r: Content) {
  const index = [...seed.payload, ...pulled.payload].findIndex(
    (t) => templateFingerprint(t) === templateFingerprint(r),
  );
  return index < 0
    ? undefined
    : {
        role: roles[index],
        side_policy:
          index >= 15 || index === 4
            ? ("optional" as const)
            : ("none" as const),
      };
}
