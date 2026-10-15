import { describe, it, expect } from "vitest";
import {
  monday,
  addDays,
  pragueToday,
  shoppingRequirements,
  reconcileShopping,
  packagesNeeded,
  generateMeals,
  shoppingCsv,
  type PlanningRecipe,
  type Pantry,
  type PlanRecipe,
  type ShoppingItem,
} from "../src/lib/planning";
const recipe: PlanningRecipe = {
  id: "a",
  recipe_id: "root",
  name: "Cibuľa",
  portions: 2,
  ingredients: [{ name: "Cibuľa", quantity: 300, unit: "g" }],
};
const choices: PlanRecipe[] = [
  {
    id: "c",
    recipe_version_id: "a",
    portions: 2,
    from_freezer: 0,
    meal_entry_id: null,
  },
];
describe("calendar in Prague", () => {
  it("Monday and year boundary", () => {
    expect(monday("2026-01-01")).toBe("2025-12-29");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });
  it("DST uses calendar dates", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(pragueToday(new Date("2026-03-29T22:30:00Z"))).toBe("2026-03-30");
  });
});
describe("shopping quantities", () => {
  it("550 minus real pantry 150 equals400", () => {
    const second = {
      ...recipe,
      id: "b",
      ingredients: [{ name: "cibuľa", quantity: 250, unit: "g" as const }],
    };
    const pantry: Pantry[] = [
      {
        id: "p",
        revision: 0,
        name: "Cibuľa",
        ingredient_key: "cibula",
        quantity: 150,
        unit: "g",
        expires_on: null,
      },
    ];
    const r = shoppingRequirements(
      [...choices, { ...choices[0], id: "d", recipe_version_id: "b" }],
      [recipe, second],
      pantry,
      "2026-10-15",
    );
    expect(r[0].quantity).toBe(400);
    expect(r[0].origins).toHaveLength(2);
    expect(packagesNeeded(400, 500)).toEqual({ count: 1, excess: 100 });
  });
  it("does not convert ml to grams or use expired pantry", () => {
    const p: Pantry = {
      id: "p",
      revision: 0,
      name: "Cibuľa",
      ingredient_key: "cibula",
      quantity: 500,
      unit: "ml",
      expires_on: null,
    };
    expect(
      shoppingRequirements(
        choices,
        [recipe],
        [p, { ...p, unit: "g", expires_on: "2026-10-14" }],
        "2026-10-15",
      )[0].quantity,
    ).toBe(300);
  });
  it("six portions minus two freezer portions cooks four", () => {
    expect(
      shoppingRequirements(
        [{ ...choices[0], portions: 6, from_freezer: 2 }],
        [recipe],
        [],
        "2026-10-15",
      )[0].quantity,
    ).toBe(600);
  });
  it("explicit aliases combine only same units", () => {
    const r = {
      ...recipe,
      ingredients: [
        ...recipe.ingredients,
        { name: "Cibule", quantity: 50, unit: "g" as const },
        { name: "Cibuľa", quantity: 1, unit: "ks" as const },
      ],
    };
    const rows = shoppingRequirements(choices, [r], [], "2026-10-15", {
      cibule: "cibula",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].quantity).toBe(350);
  });
  it("preserves manual lines and confirmed removed choices", () => {
    const manual: ShoppingItem = {
      id: "m",
      name: "Víno",
      ingredient_key: "vino",
      unit: "ks",
      quantity: 1,
      required: 0,
      manual: true,
      checked: false,
      origins: [],
      selection: null,
    };
    const checked = {
      ...manual,
      id: "x",
      manual: false,
      checked: true,
      name: "Mäso",
    };
    const r = reconcileShopping([], [manual, checked], () => "new");
    expect(r.items).toHaveLength(2);
    expect(r.conflicts).toHaveLength(1);
  });
  it("recomputes shared requirement after recipe replacement", () => {
    const old: ShoppingItem = {
      id: "old",
      name: "Cibuľa",
      ingredient_key: "cibula",
      unit: "g",
      quantity: 550,
      required: 550,
      manual: false,
      checked: false,
      origins: [],
      selection: null,
    };
    expect(
      reconcileShopping(
        shoppingRequirements(choices, [recipe], [], "2026-10-15"),
        [old],
        () => "new",
      ).items[0],
    ).toMatchObject({ id: "old", quantity: 300 });
  });
  it("keeps explicit quantity override", () => {
    const old: ShoppingItem = {
      id: "old",
      name: "Cibuľa",
      ingredient_key: "cibula",
      unit: "g",
      quantity: 1000,
      required: 550,
      manual: false,
      checked: false,
      origins: [],
      selection: { quantity_override: true },
    };
    expect(
      reconcileShopping(
        shoppingRequirements(choices, [recipe], [], "2026-10-15"),
        [old],
        () => "new",
      ).items[0].quantity,
    ).toBe(1000);
  });
});
it("generator uses hard bans and avoids repetition without writes", () => {
  const beef = { ...recipe, id: "beef", name: "Hovädzie", meat: "beef" },
    chicken = { ...recipe, id: "chicken", name: "Kuracie", meat: "chicken" };
  let n = 0;
  const result = generateMeals(
    [recipe, beef, chicken],
    "2026-10-12",
    7,
    2,
    2,
    [],
    [],
    ["hovädzie"],
    () => String(n++),
  );
  expect(result).toHaveLength(14);
  expect(result.some((r) => r.recipe_version_id === "beef")).toBe(false);
  expect(new Set(result.map((r) => r.id)).size).toBe(14);
  expect(result[0].portions).toBe(2);
});
it("CSV protects spreadsheet formulas", () => {
  expect(
    shoppingCsv({
      id: "x",
      name: "x",
      status: "draft",
      recipes: [],
      items: [
        {
          id: "m",
          name: "=1+2",
          ingredient_key: "x",
          unit: "ks",
          quantity: 1,
          required: 0,
          manual: true,
          checked: false,
          origins: [],
          selection: null,
        },
      ],
    }),
  ).toContain("'=1+2");
});
it("generator does not promise unknown ready portions", () => {
  expect(() =>
    generateMeals([recipe], "2026-10-12", 2, 1, 1, [], [], [], () => "id", {
      available: { root: null },
      cookingDays: 0,
    }),
  ).toThrow("preukázaných");
});
it("ready days allocate known portions once and cooking days scale batches", () => {
  let n = 0;
  const rows = generateMeals(
    [recipe],
    "2026-10-12",
    3,
    2,
    1,
    [],
    [],
    [],
    () => String(n++),
    { available: { root: 4 }, cookingDays: 1, batchPortions: 6 },
  );
  expect(rows.map((r) => r.ready_portions)).toEqual([0, 2, 2]);
  expect(rows[0].batch_portions).toBe(6);
  expect(() =>
    generateMeals(
      [recipe],
      "2026-10-12",
      4,
      2,
      1,
      [],
      [],
      [],
      () => String(n++),
      { available: { root: 4 }, cookingDays: 1 },
    ),
  ).toThrow("preukázaných");
});
it("known historical costs can reject over-budget proposals, unknown costs stay unknown", () => {
  const priced = { ...recipe, estimated_cost_minor: 10000 };
  expect(() =>
    generateMeals([priced], "2026-10-12", 2, 2, 1, [], [], [], () => "id", {
      budgetMinor: 100,
    }),
  ).toThrow("rozpočet");
  expect(
    generateMeals([recipe], "2026-10-12", 2, 2, 1, [], [], [], () => "id", {
      budgetMinor: 100,
    }),
  ).toHaveLength(2);
});
it("pack rounding handles minimum and zero demand", () => {
  expect(packagesNeeded(100, 500, 2)).toEqual({ count: 2, excess: 900 });
  expect(packagesNeeded(0, 500)).toEqual({ count: 0, excess: 0 });
  expect(() => packagesNeeded(100, 500, 1.5)).toThrow();
});

it("structured Rohlik task skips purchased products and requires product/cart confirmation", async () => {
  const { rohlikShoppingTask } = await import("../src/lib/planning");
  const item: ShoppingItem = {
    id: "i",
    ingredient_key: "cibula",
    name: "Cibuľa",
    unit: "g",
    required: 400,
    quantity: 500,
    manual: false,
    checked: false,
    origins: [],
    selection: { pack_quantity: 500 },
  };
  const task = rohlikShoppingTask(
    {
      id: "p",
      name: "Plán",
      status: "draft",
      recipes: [],
      items: [item, { ...item, id: "bought", checked: true }],
    },
    "2026-10-15T00:00:00Z",
  );
  expect(task.items).toHaveLength(1);
  expect(task.items[0]).toMatchObject({
    productId: null,
    currentPriceMinor: null,
    availability: null,
    packQuantity: 500,
  });
  expect(task.constraints).toMatchObject({
    preserveExistingCart: true,
    requireProductConfirmation: true,
    requireCartDiffConfirmation: true,
    allowCheckout: false,
    allowPayment: false,
  });
  expect(task.connection).toBe("not_connected");
});
