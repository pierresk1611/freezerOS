import { it, expect } from "vitest";
import example from "../docs/meal-prep-import.example.json";
import {
  parsePrep,
  prepMeals,
  prepChoices,
  prepError,
} from "../src/lib/meal-prep";
import { shoppingRequirements } from "../src/lib/planning";
it("authoritative JSON schema validates full example and Cyrillic/Slovak text", () => {
  expect(parsePrep(example).recipes).toHaveLength(3);
  expect(
    parsePrep({ ...example, name: "Mäso, cvikla a prílohy — týždeň" }).name,
  ).toContain("cvikla");
});
it("invalid fields include exact recipe path; unknown properties are rejected", () => {
  expect(() =>
    parsePrep({
      ...example,
      recipes: [{ ...example.recipes[0], planned_portions: -1 }],
    }),
  ).toThrow();
  try {
    parsePrep({
      ...example,
      recipes: [
        {
          ...example.recipes[0],
          recipe: { ...example.recipes[0].recipe, portions: -1 },
        },
      ],
    });
  } catch (e) {
    expect(prepError(e)).toContain("recipes.0.recipe.portions");
  }
  expect(() => parsePrep({ ...example, inventory: [] })).toThrow();
});
it("unknown units and unsafe numeric money fail schema", () => {
  const item = structuredClone(example.recipes[0]);
  item.recipe.ingredients[0].unit = "kg";
  expect(() => parsePrep({ ...example, recipes: [item] })).toThrow();
  expect(() =>
    parsePrep({
      ...example,
      recipes: [{ ...example.recipes[0], estimated_cost_minor: 1.25 }],
    }),
  ).toThrow();
});
it("duplicate keys and missing dependencies fail", () => {
  expect(() =>
    parsePrep({
      ...example,
      recipes: [example.recipes[0], example.recipes[0]],
    }),
  ).toThrow("kľúč");
  expect(() =>
    parsePrep({
      ...example,
      recipes: [{ ...example.recipes[0], compatible_sides: ["missing"] }],
    }),
  ).toThrow("príloha");
});
it("selected recipes aggregate ingredients and scale portions without volume-to-weight guessing", () => {
  const d = parsePrep(example);
  const rows = d.recipes.map((r, i) => ({
    id: "row" + i,
    local_key: r.key,
    recipe_version_id: r.key,
    portions: r.planned_portions,
    details: r,
  }));
  const requirements = shoppingRequirements(
    prepChoices(rows),
    d.recipes.map((r) => ({ ...r.recipe, id: r.key, recipe_id: r.key })),
    [],
    d.cooking_date,
  );
  expect(
    requirements.filter((r) => r.ingredient_key === "cibula"),
  ).toHaveLength(1);
  expect(requirements.every((i) => i.quantity >= 0)).toBe(true);
  expect(prepMeals(d, rows, () => crypto.randomUUID())).toHaveLength(2);
  expect(
    prepMeals(
      d,
      rows.filter((r) => r.local_key !== "rice"),
      () => crypto.randomUUID(),
    ),
  ).toHaveLength(1);
});
it("AI meal plans cannot promote rice or mash to lunch or attach unconfirmed sides", () => {
  expect(() =>
    parsePrep({
      ...example,
      meal_plan: [
        { day_offset: 1, slot: "lunch", main: "rice", sides: [], portions: 2 },
      ],
    }),
  ).toThrow("samostatné");
  expect(() =>
    parsePrep({
      ...example,
      recipes: example.recipes.map((r) =>
        r.key === "pork" ? { ...r, compatible_sides: [] } : r,
      ),
    }),
  ).toThrow("nepotvrdená");
});
