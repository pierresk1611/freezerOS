import { describe, it, expect } from "vitest";
import {
  generateSchedule,
  shoppingFromMeals,
  proposalChanges,
  validateSchedule,
  batchUsage,
  eligibleMain,
} from "../src/lib/culinary-planning";
import { shoppingRequirements, type PlanningRecipe } from "../src/lib/planning";
import { roleProposal } from "../src/lib/role-proposals";
import seed from "../docs/seed-recipes.json";
const main: PlanningRecipe = {
  id: "m",
  recipe_id: "mr",
  name: "Sticky Ginger Pulled Pork — pomaly pečené šťavnaté bravčové",
  portions: 2,
  meal_role: "main",
  allowed_slots: ["lunch", "dinner"],
  side_policy: "optional",
  compatible_side_ids: ["rr"],
  ingredients: [{ name: "Cibuľa", quantity: 100, unit: "g" }],
};
const rice: PlanningRecipe = {
  id: "r",
  recipe_id: "rr",
  name: "Jazmínová ryža",
  portions: 2,
  meal_role: "side",
  allowed_slots: ["lunch", "dinner"],
  ingredients: [
    { name: "Ryža", quantity: 150, unit: "g" },
    { name: "Cibuľa", quantity: 20, unit: "g" },
  ],
};
let serial = 0;
const uuid = () => `test-${serial++}`;
const generate = (recipes: PlanningRecipe[] = [main, rice]) =>
  generateSchedule(recipes, "2026-10-12", 3, 2, 1, [], [], [], uuid, {
    cookingDays: 1,
    batchPortions: 6,
    includeSides: true,
  });
describe("culinary planning", () => {
  for (const name of [
    "Jazmínová ryža",
    "Zemiaková kaša",
    "Pečená cvikla",
    "Nakladaná cvikla",
  ])
    it(`${name} never an automatic standalone lunch or dinner`, () => {
      const side = { ...rice, name };
      for (const slot of ["lunch", "dinner"])
        expect(eligibleMain(side, slot)).toBe(false);
      expect(() => generate([side])).toThrow("zatriedený");
    });
  it("unknown role fails closed, even with a main sounding name", () => {
    expect(() => generate([{ ...main, meal_role: undefined }])).toThrow(
      "zatriedený",
    );
  });
  it("complete meals need no side; slot permissions remain explicit", () => {
    const r = {
      ...main,
      meal_role: "complete" as const,
      side_policy: "none" as const,
    };
    expect(
      generate([r, rice]).entries.every((e) => !e.components?.length),
    ).toBe(true);
    expect(() => generate([{ ...r, allowed_slots: ["breakfast"] }])).toThrow();
  });
  it("one logical meal carries sides and six portion batch covers three meals", () => {
    const s = generate();
    expect(s.entries).toHaveLength(3);
    expect(s.entries.every((e) => e.components?.length === 1)).toBe(true);
    expect(s.batches).toHaveLength(2);
    expect(s.batches.every((b) => batchUsage(b.id, s.entries) === 6)).toBe(
      true,
    );
    expect(new Set(s.entries.map((e) => e.planned_batch_id)).size).toBe(1);
  });
  it("shopping counts batch yield and components once with shared ingredients", () => {
    const s = generate();
    const choices = shoppingFromMeals(s.entries, s.batches, uuid);
    expect(choices).toHaveLength(2);
    const shopping = shoppingRequirements(
      choices,
      [main, rice],
      [],
      "2026-10-12",
    );
    expect(shopping.find((i) => i.name === "Ryža")?.quantity).toBe(450);
    expect(shopping.find((i) => i.name === "Cibuľa")?.quantity).toBe(360);
  });
  it("known freezer portions are planned once, no input mutation or stock decrement", () => {
    const available = { mr: 4 };
    const before = JSON.stringify(available);
    const s = generateSchedule(
      [main, rice],
      "2026-10-12",
      3,
      2,
      1,
      [],
      [],
      [],
      uuid,
      { available, includeSides: false },
    );
    expect(s.entries.map((e) => e.ready_portions)).toEqual([2, 2, 0]);
    expect(JSON.stringify(available)).toBe(before);
  });
  it("repeat fill is empty, replacement preserves date, logical ID and portions", () => {
    const s = generate();
    const current = s.entries.map((e) => ({ ...e, revision: 0 }));
    expect(proposalChanges(s, current, "fill", [], uuid)).toEqual([]);
    const diff = proposalChanges(s, current, "selected", [current[0].id], uuid);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      id: current[0].id,
      meal_date: current[0].meal_date,
      portions: 2,
      revision: 0,
    });
  });
  it("rejects duplicate sides and wrong batch recipe, date or overcapacity", () => {
    const s = generate();
    expect(() =>
      validateSchedule(
        [
          {
            ...s.entries[0],
            components: [
              s.entries[0].components![0],
              s.entries[0].components![0],
            ],
          },
        ],
        s.batches,
        [main, rice],
      ),
    ).toThrow();
    expect(() =>
      validateSchedule(
        s.entries,
        s.batches.map((b) => ({ ...b, portions: 1 })),
        [main, rice],
      ),
    ).toThrow("dostatok");
    expect(() =>
      validateSchedule(
        s.entries,
        s.batches.map((b) => ({ ...b, cooking_date: "2026-10-20" })),
        [main, rice],
      ),
    ).toThrow("várka");
  });
  it("template proposals require actual content, never arbitrary name matches", () => {
    const beet = seed.payload.find((r) => r.name === "Pečená cvikla")!;
    expect(roleProposal(beet)?.role).toBe("vegetable_side");
    expect(
      roleProposal({
        ...beet,
        ingredients: [{ name: "Mäso", quantity: 500, unit: "g" }],
      }),
    ).toBeUndefined();
  });
});
