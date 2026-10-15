import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const source = (payload: unknown[], id = randomUUID()) => ({
  schemaVersion: "1.0",
  importId: id,
  importType: "recipes",
  source: "Lokálny E2E test",
  generatedAt: "2026-10-15T07:00:00Z",
  payload,
});
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
test("12 receptov → výber → presne 12 → rovnaký súbor bez duplicít", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const token = info.project.name + " " + randomUUID().slice(0, 8),
    c = await client();
  const recipes = Array.from({ length: 12 }, (_, i) => ({
    name: `Batch ${token} ${i + 1}`,
    portions: 2,
    ingredients: [{ name: "Hovädzie", quantity: 500 + i, unit: "g" }],
    steps: [`Testovací postup ${token} ${i + 1}`],
    reheating: "Dôkladne prehrejte.",
    storage: "Rýchlo schlaďte.",
    meat: "beef",
    freezing: true,
  }));
  const envelope = source(recipes),
    file = {
      name: "dvanast.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(envelope)),
    };
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto("/recipes/import");
  await page
    .getByLabel("Vybrať JSON súbory", { exact: true })
    .setInputFiles(file);
  await expect(
    page.getByRole("heading", { name: "Náhľad všetkých 12 receptov" }),
  ).toBeVisible();
  await expect(page.locator(".import-row")).toHaveCount(12);
  for (const recipe of recipes)
    await expect(
      page.getByRole("checkbox", {
        name: "Vybrať " + recipe.name,
        exact: true,
      }),
    ).toBeChecked();
  expect(
    (
      await c
        .from("recipe_versions")
        .select("id")
        .like("name", `Batch ${token}%`)
    ).data,
  ).toHaveLength(0);
  await page.screenshot({
    path: `test-results/batch-preview-${info.project.name}.png`,
    fullPage: true,
    caret: "initial",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Importovať vybrané recepty", exact: true })
    .click();
  const result = page.getByRole("region", { name: "Výsledok importu" });
  await expect(result).toContainText("Pridané: 12");
  await expect(result).toContainText("Chybné: 0");
  const imported = await c
    .from("recipe_versions")
    .select("*")
    .like("name", `Batch ${token}%`);
  expect(imported.data).toHaveLength(12);
  expect(new Set(imported.data!.map((v) => v.recipe_id)).size).toBe(12);
  await page
    .getByRole("link", { name: "Zobraziť importované recepty" })
    .click();
  await expect(page).toHaveURL(/\/recipes\?ids=/);
  await expect(page.locator(".recipe-tile")).toHaveCount(12);
  await page.goto("/recipes/import");
  await page
    .getByLabel("Vybrať JSON súbory", { exact: true })
    .setInputFiles(file);
  await expect(
    page.getByRole("heading", { name: "Náhľad všetkých 12 receptov" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Už spracované — opakované nahratie nevytvorí recept ani novú verziu.",
      { exact: true },
    ),
  ).toHaveCount(12);
  await page
    .getByRole("button", { name: "Importovať vybrané recepty", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Preskočené: 12");
  expect(
    (
      await c
        .from("recipe_versions")
        .select("id")
        .like("name", `Batch ${token}%`)
    ).data,
  ).toHaveLength(12);
  const newer = {
    ...recipes[0],
    steps: ["Výslovne potvrdený nový postup " + token],
  };
  await page.getByLabel("Vybrať JSON súbory", { exact: true }).setInputFiles([
    {
      name: "uprava.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source([newer]))),
    },
    {
      name: "druhy.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify(
          source([
            {
              ...recipes[1],
              name: "Nový " + token,
              steps: ["Samostatné nové jedlo " + token],
            },
          ]),
        ),
      ),
    },
  ]);
  await expect(
    page.getByRole("heading", { name: "Náhľad všetkých 2 receptov" }),
  ).toBeVisible();
  await page
    .getByLabel("Spracovanie " + newer.name, { exact: true })
    .selectOption("version");
  await expect(
    page.getByRole("button", {
      name: "Importovať vybrané recepty",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "Potvrdiť novú verziu " + newer.name,
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Importovať vybrané recepty", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Nové verzie: 1");
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Pridané: 1");
  const history = await c
    .from("recipe_versions")
    .select("*")
    .eq("recipe_id", imported.data![0].recipe_id);
  expect(history.data!.find((v) => v.version === 1)).toBeDefined();
  expect(
    (await c.from("recipe_versions").select("*").eq("name", newer.name)).data,
  ).toHaveLength(2);
});

test("neplatný súbor a položka, preskočenie a drag & drop", async ({
  page,
}, info) => {
  const token = randomUUID().slice(0, 8) + info.project.name;
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto("/recipes/import");
  const recipe = {
    name: "Drop " + token,
    portions: 2,
    ingredients: [{ name: "Ryža", quantity: 100, unit: "g" }],
    steps: ["Test " + token],
    reheating: "Prehriať.",
    storage: "Schladiť.",
  };
  const data = source([recipe, { name: "Chybné " + token }]);
  await page.getByLabel("Vybrať JSON súbory", { exact: true }).setInputFiles([
    {
      name: "chyba.json",
      mimeType: "application/json",
      buffer: Buffer.from("not JSON"),
    },
    {
      name: "valid.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    },
  ]);
  await expect(page.locator(".batch-import [role=alert]")).toContainText([
    "chyba.json",
  ]);
  await expect(page.locator(".import-row")).toHaveCount(2);
  await page
    .getByRole("checkbox", { name: "Vybrať " + recipe.name, exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Importovať vybrané recepty", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Pridané: 0");
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Chybné: 2");
  const transfer = await page.evaluateHandle(
    ({ text }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], "drop.json", { type: "application/json" }));
      return dt;
    },
    { text: JSON.stringify(source([recipe])) },
  );
  await page
    .locator(".import-drop")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.getByRole("heading", { name: "Náhľad všetkých 1 receptov" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Importovať vybrané recepty", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Pridané: 1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("pôvodný import šablón po úpravách zobrazuje skutočný stav a odkazy", async ({
  page,
}) => {
  const c = createClient(
    process.env.FREEZER_TEST_API_URL!,
    process.env.FREEZER_TEST_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await c.auth.signInWithPassword({
    email: process.env.FREEZER_LEGACY_EMAIL!,
    password: process.env.FREEZER_LEGACY_PASSWORD!,
  });
  const before = (await c.from("recipe_versions").select("*")).data!;
  expect(before).toHaveLength(5);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_LEGACY_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_LEGACY_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto("/recipes/pulled");
  await expect(
    page.getByRole("heading", { name: "4 recepty už boli pridané" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pridať 4 recepty", exact: true }),
  ).toHaveCount(0);
  const link = page.getByRole("link", {
    name: "Moje upravené trhané bravčové",
    exact: true,
  });
  await expect(link).toBeVisible();
  await link.click();
  await expect(
    page.getByRole("heading", {
      name: "Moje upravené trhané bravčové",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Používateľský postup zachovať.", { exact: true }),
  ).toBeVisible();
  await page.goto("/recipes");
  await expect(
    page.getByRole("link", { name: "Trhané mäso", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Nové šablóny trhaného mäsa", exact: true }),
  ).toHaveCount(0);
  expect((await c.from("recipe_versions").select("*")).data).toHaveLength(5);
  expect((await c.from("recipe_import_sources").select("*")).data).toHaveLength(
    0,
  );
});

test("zlyhanie importu nie je úspech; bezpečný opakovaný pokus", async ({
  page,
}, info) => {
  const token = info.project.name + " " + randomUUID().slice(0, 8);
  const recipe = {
    name: "Retry " + token,
    portions: 2,
    ingredients: [{ name: "Mäso", quantity: 600, unit: "g" }],
    steps: ["Test retry " + token],
    reheating: "Ohriať.",
    storage: "Schladiť.",
  };
  const data = source([recipe]),
    c = await client();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto("/recipes/import");
  await page
    .getByLabel("Vybrať JSON súbory", { exact: true })
    .setInputFiles({
      name: "retry.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await expect(page.locator(".import-row")).toHaveCount(1);
  await page.route("**/api/recipes/import", async (route) => {
    if (route.request().postDataJSON().action === "apply")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Testovací výpadok importu" }),
      });
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Importovať vybrané recepty", exact: true })
    .click();
  await expect(
    page.locator(".batch-import [role=alert]").first(),
  ).toContainText("Testovací výpadok importu");
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Pridané: 0");
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Chybné: 1");
  expect(
    (await c.from("recipe_versions").select("id").eq("name", recipe.name)).data,
  ).toHaveLength(0);
  await page.unroute("**/api/recipes/import");
  await page
    .getByRole("button", { name: "Importovať vybrané recepty", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Pridané: 1");
  await page
    .getByRole("button", { name: "Importovať vybrané recepty", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Preskočené: 1");
  expect(
    (await c.from("recipe_versions").select("id").eq("name", recipe.name)).data,
  ).toHaveLength(1);
});
