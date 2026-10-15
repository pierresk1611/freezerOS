import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const example = JSON.parse(
  readFileSync("docs/meal-prep-import.example.json", "utf8"),
);
async function client() {
  const c = createClient(
    process.env.FREEZER_TEST_API_URL!,
    process.env.FREEZER_TEST_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await c.auth.signInWithPassword({
    email: process.env.FREEZER_TEST_EMAIL!,
    password: process.env.FREEZER_TEST_PASSWORD!,
  });
  return c;
}
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
}
function makeDocument(name: string, count: number) {
  return {
    ...example,
    importId: randomUUID(),
    name,
    target_portions: count * 6,
    recipes: Array.from({ length: count }, (_, i) => ({
      ...example.recipes[0],
      key: "meal_" + i,
      compatible_sides: [],
      recipe: {
        ...example.recipes[0].recipe,
        name: name + " recept " + i,
        meal_role: "complete",
        side_policy: "none",
        ingredients: [{ name: "Cibuľa " + name, quantity: 100 + i, unit: "g" }],
      },
    })),
    timeline: [],
    meal_plan: [],
  };
}
test("AI meal prep imports ten recipes, persists shared shopping, manual items and replay safely", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const c = await client(),
    tag = "AI " + info.project.name + " " + randomUUID().slice(0, 6),
    doc = makeDocument(tag, 10);
  await login(page);
  await page.goto("/meal-preps/import");
  await page.getByLabel("Vybrať JSON súbory").setInputFiles({
    name: "meal-prep.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(
    page.getByRole("heading", { name: tag, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".prep-preview-recipe")).toHaveCount(10);
  await page
    .getByRole("button", { name: "Importovať vybrané meal-prepy", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Otvoriť meal prep →", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("link", { name: "Otvoriť meal prep →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: tag, exact: true }),
  ).toBeVisible();
  const project = (
    await c
      .from("meal_prep_projects")
      .select("*")
      .eq("import_id", doc.importId)
      .single()
  ).data!;
  const rows = (
    await c
      .from("meal_prep_project_recipes")
      .select("*")
      .eq("project_id", project.id)
  ).data!;
  expect(rows).toHaveLength(10);
  const counts = (
    await c
      .from("recipe_versions")
      .select("id")
      .in(
        "id",
        rows.map((r) => r.recipe_version_id),
      )
  ).data!;
  expect(counts).toHaveLength(10);
  await page.getByLabel("Porcie meal_0", { exact: true }).fill("8");
  await page.getByText("+ Pridať vlastnú položku", { exact: true }).click();
  await page.getByLabel("Názov položky", { exact: true }).fill("Vrecká " + tag);
  await page
    .getByRole("button", { name: "Pridať manuálnu položku", exact: true })
    .click();
  const line = page.locator(".prep-check").filter({ hasText: "Vrecká " + tag });
  await line.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Uložiť projekt a nákup", exact: true })
    .click();
  await expect(page.locator(".planning-dirty")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Porcie meal_0", { exact: true })).toHaveValue(
    "8",
  );
  await expect(
    page
      .locator(".prep-check")
      .filter({ hasText: "Vrecká " + tag })
      .getByRole("checkbox"),
  ).toBeChecked();
  const items = (
    await c
      .from("shopping_plan_items")
      .select("*")
      .eq("plan_id", project.shopping_plan_id)
  ).data!;
  expect(items.filter((i) => !i.manual)).toHaveLength(1);
  expect(Number(items.find((i) => !i.manual)!.quantity)).toBeCloseTo(
    1078.3333,
    2,
  );
  expect(items.find((i) => i.manual)?.checked).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const contrast = await page.locator(".prep-summary").evaluate((el) => {
      const style = getComputedStyle(el);
      const luminance = (color: string) => {
        const rgb = color
          .match(/\d+/g)!
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            const n = v / 255;
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const a = luminance(style.color),
        b = luminance(style.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await expect(
      page.locator(".prep-instructions").first(),
    ).not.toHaveAttribute("open", "");
    await page.locator(".prep-summary").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/meal-prep-${info.project.name}-${colorScheme}.png`,
      fullPage: false,
    });
  }
  await expect(
    page
      .locator(".sidebar")
      .getByRole("link", { name: "Meal prepy", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Sekcie receptov" })
      .getByRole("link", { name: "Meal prep projekty", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const version = (
    await c
      .from("recipe_versions")
      .select("recipe_id")
      .eq("id", rows[0].recipe_version_id)
      .single()
  ).data!;
  await page.goto("/recipes/" + version.recipe_id);
  await expect(
    page
      .locator(".recipe-linked-projects")
      .getByRole("link", { name: tag + " →", exact: true }),
  ).toBeVisible();
  await page
    .locator(".recipe-linked-projects")
    .getByRole("link", { name: tag + " →", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp("/meal-preps/" + project.id + "$"));
  await page
    .getByRole("navigation", { name: "Sekcie receptov" })
    .getByRole("link", { name: "Knižnica receptov", exact: true })
    .click();
  await expect(page).toHaveURL(/\/recipes$/);
  await page
    .getByRole("navigation", { name: "Sekcie receptov" })
    .getByRole("link", { name: "Meal prep projekty", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Meal prep projekty", exact: true }),
  ).toBeVisible();
  await page.goto("/meal-preps/import");
  await page.getByLabel("Vybrať JSON súbory").setInputFiles({
    name: "replay.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await page
    .getByRole("button", { name: "Importovať vybrané meal-prepy", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Otvoriť meal prep →", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  expect(
    (
      await c
        .from("meal_prep_projects")
        .select("id")
        .eq("import_id", doc.importId)
    ).data,
  ).toHaveLength(1);
  expect(
    (
      await c
        .from("meal_prep_project_recipes")
        .select("id")
        .eq("project_id", project.id)
    ).data,
  ).toHaveLength(10);
  expect(
    (
      await c
        .from("cooking_batches")
        .select("id")
        .in(
          "recipe_version_id",
          rows.map((r) => r.recipe_version_id),
        )
    ).data,
  ).toEqual([]);
});
test("AI import validates fields, supports multiple files and selection", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await login(page);
  await page.goto("/meal-preps/import");
  await page
    .getByLabel("Vložiť JSON", { exact: true })
    .fill('{"format":"wrong"}');
  await page
    .getByRole("button", { name: "Načítať náhľad", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "format",
  );
  const docs = [
    makeDocument(
      "Multi A " + info.project.name + " " + randomUUID().slice(0, 6),
      3,
    ),
    makeDocument(
      "Multi B " + info.project.name + " " + randomUUID().slice(0, 6),
      3,
    ),
  ];
  const files = docs.map((doc, i) => ({
    name: "prep-" + i + ".json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(doc)),
  }));
  if (Number(info.project.name) >= 1024) {
    const transfer = await page.evaluateHandle(
      (texts) => {
        const data = new DataTransfer();
        texts.forEach((text, i) =>
          data.items.add(
            new File([text], "prep-" + i + ".json", {
              type: "application/json",
            }),
          ),
        );
        return data;
      },
      docs.map((d) => JSON.stringify(d)),
    );
    await page
      .locator(".prep-drop")
      .dispatchEvent("drop", { dataTransfer: transfer });
  } else await page.getByLabel("Vybrať JSON súbory").setInputFiles(files);
  await expect(page.locator(".prep-preview-recipe")).toHaveCount(6);
  await page
    .locator(".prep-preview-recipe")
    .first()
    .getByRole("checkbox")
    .uncheck();
  await page
    .getByRole("button", { name: "Importovať vybrané meal-prepy", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Otvoriť meal prep →", exact: true }),
  ).toHaveCount(2, { timeout: 30000 });
  const c = await client();
  const projects = (
    await c
      .from("meal_prep_projects")
      .select("id,import_id")
      .in(
        "import_id",
        docs.map((d) => d.importId),
      )
  ).data!;
  expect(projects).toHaveLength(2);
  const first = projects.find((p) => p.import_id === docs[0].importId)!;
  expect(
    (
      await c
        .from("meal_prep_project_recipes")
        .select("id")
        .eq("project_id", first.id)
    ).data,
  ).toHaveLength(2);
});

test("AI project explicitly links combined calendar and a real batch without duplicate inventory", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const c = await client(),
    tag = "Prep workflow " + info.project.name + " " + randomUUID().slice(0, 6);
  const year =
    2080 + [360, 390, 768, 1280, 1440, 1536].indexOf(Number(info.project.name));
  const doc = {
    ...structuredClone(example),
    importId: randomUUID(),
    name: tag,
    cooking_date: year + "-01-07",
  };
  doc.recipes = doc.recipes.map(
    (entry: (typeof example.recipes)[number], i: number) => ({
      ...entry,
      recipe: {
        ...entry.recipe,
        name: entry.recipe.name + " " + tag,
        ingredients: [
          ...entry.recipe.ingredients,
          { name: "Test ingrediencia " + tag, quantity: 10 + i, unit: "g" },
        ],
      },
    }),
  );
  await login(page);
  await page.goto("/meal-preps/import");
  await page
    .getByLabel("Vložiť JSON", { exact: true })
    .fill(JSON.stringify(doc));
  await page
    .getByRole("button", { name: "Načítať náhľad", exact: true })
    .click();
  await expect(page.locator(".prep-preview-recipe")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Importovať vybrané meal-prepy", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Otvoriť meal prep →", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("link", { name: "Otvoriť meal prep →", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pripraviť jedálniček — náhľad", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Náhľad jedálnička" }),
  ).toContainText("Prepojenie na jedálniček");
  await page
    .getByRole("button", {
      name: "Potvrdiť pridanie do jedálnička",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Náhľad jedálnička" }),
  ).toHaveCount(0);
  const project = (
    await c
      .from("meal_prep_projects")
      .select("id")
      .eq("import_id", doc.importId)
      .single()
  ).data!;
  const rows = (
    await c
      .from("meal_prep_project_recipes")
      .select("*")
      .eq("project_id", project.id)
  ).data!;
  const links = (
    await c
      .from("meal_prep_calendar_links")
      .select("*")
      .eq("project_id", project.id)
  ).data!;
  expect(links).toHaveLength(2);
  expect(
    (
      await c
        .from("meal_plan_components")
        .select("*")
        .in(
          "entry_id",
          links.map((l) => l.entry_id),
        )
    ).data,
  ).toHaveLength(2);
  const main = rows.find((r) => r.local_key === "pork")!;
  expect(
    (
      await c.rpc("create_batch", {
        p_version_id: main.recipe_version_id,
        p_request_id: randomUUID(),
        p_weight_g: 1200,
        p_package_count: 3,
        p_cost_minor: null,
        p_best_before: year + "-04-01",
      })
    ).error,
  ).toBeNull();
  const batch = (
    await c
      .from("cooking_batches")
      .select("*")
      .eq("recipe_version_id", main.recipe_version_id)
      .single()
  ).data!;
  const packages = (
    await c
      .from("inventory_packages")
      .select("id,remaining_g")
      .eq("batch_id", batch.id)
      .order("id")
  ).data!;
  expect(packages).toHaveLength(3);
  await page.reload();
  for (const summary of await page
    .getByText("Suroviny, postup a mrazenie", { exact: true })
    .all())
    await summary.click();
  for (const summary of await page
    .getByText("Prepojiť skutočne uvarenú várku", { exact: true })
    .all())
    await summary.click();
  await page
    .getByLabel("Skutočná várka pork", { exact: true })
    .selectOption(batch.id);
  await page.getByLabel("Skutočné porcie pork", { exact: true }).fill("6");
  const recipeCard = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: doc.recipes[0].recipe.name,
      exact: true,
    }),
  });
  await recipeCard
    .getByRole("button", {
      name: "Potvrdiť prepojenie skutočnej várky",
      exact: true,
    })
    .click();
  await expect(
    recipeCard.getByText("Potvrdené: 6 porcií", { exact: false }),
  ).toBeVisible();
  expect(
    (
      await c
        .from("inventory_packages")
        .select("id,remaining_g")
        .eq("batch_id", batch.id)
        .order("id")
    ).data,
  ).toEqual(packages);
  await expect(
    recipeCard.getByRole("link", {
      name: "Štítok 50 × 30 mm (PNG/PDF)",
      exact: true,
    }),
  ).toHaveCount(3);
});
