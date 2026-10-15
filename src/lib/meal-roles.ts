import { z } from "zod";
export const mealRoles = {
  unknown: "Nezatriedené",
  main: "Hlavné jedlo",
  complete: "Kompletné samostatné jedlo",
  side: "Príloha",
  vegetable_side: "Zeleninová príloha",
  component: "Komponent jedla",
  breakfast: "Raňajkové jedlo",
  snack: "Snack / dezert",
} as const;
export const roleSchema = z.enum([
  "unknown",
  "main",
  "complete",
  "side",
  "vegetable_side",
  "component",
  "breakfast",
  "snack",
]);
export type MealRole = z.infer<typeof roleSchema>;
export const slotSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export const planningMetadata = {
  meal_role: roleSchema.optional(),
  allowed_slots: z
    .array(slotSchema)
    .max(4)
    .refine((a) => new Set(a).size === a.length)
    .optional(),
  side_policy: z.enum(["none", "optional", "required"]).optional(),
  compatible_side_ids: z
    .array(z.string().uuid())
    .max(30)
    .refine((a) => new Set(a).size === a.length)
    .optional(),
};
export function defaultSlots(role: MealRole) {
  return role === "breakfast"
    ? (["breakfast"] as const)
    : role === "snack"
      ? (["snack"] as const)
      : (["lunch", "dinner"] as const);
}
export function isMainRole(role: MealRole | undefined, slot: string) {
  return slot === "breakfast"
    ? role === "breakfast" || role === "complete"
    : slot === "snack"
      ? role === "snack"
      : role === "main" || role === "complete";
}
export function isSideRole(role: MealRole | undefined) {
  return role === "side" || role === "vegetable_side" || role === "component";
}
