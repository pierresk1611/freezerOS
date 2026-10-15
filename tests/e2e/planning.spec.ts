import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { monday as weekMonday } from "../../src/lib/planning";
test("planner persists replacement, shopping recalculates and pantry is real", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  const isolatedWeek = weekMonday(
    2050 +
      [360, 390, 768, 1280, 1440, 1536].indexOf(Number(info.project.name)) +
      "-01-04",
  );
  await page.goto("/meal-plan?week=" + isolatedWeek);
  await page
    .getByRole("button", { name: "+ Pridať", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Manuálny výber", { exact: false }).check();
  await expect(
    dialog.getByLabel("Hlavné jedlo", { exact: true }),
  ).toBeVisible();
  const options = await dialog
    .getByLabel("Hlavné jedlo", { exact: true })
    .locator("option")
    .evaluateAll((es) =>
      es.map((e) => ({
        value: (e as HTMLOptionElement).value,
        label: e.textContent,
      })),
    );
  expect(options.length).toBeGreaterThan(1);
  await dialog
    .getByLabel("Hlavné jedlo", { exact: true })
    .selectOption(options[0].value);
  await dialog.getByLabel("Počet porcií").fill("3");
  await dialog
    .getByRole("button", { name: "Potvrdiť výmenu a uložiť", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const card = page
    .locator(".planned-meal")
    .filter({ hasText: options[0].label! })
    .first();
  await expect(card).toContainText("3 porcie");
  await card.getByRole("button", { name: "Vymeniť", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Manuálny výber", { exact: false })
    .check();
  await page
    .getByRole("dialog")
    .getByLabel("Hlavné jedlo", { exact: true })
    .selectOption(options[1].value);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Potvrdiť výmenu a uložiť", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page
      .locator(".planned-meal")
      .filter({ hasText: options[1].label! })
      .first(),
  ).toContainText("3 porcie");
  await page.goto("/shopping");
  await page
    .getByRole("button", { name: "Nový meal prep nákup", exact: true })
    .click();
  const title = "Nákup " + info.project.name + " " + randomUUID().slice(0, 8);
  await page.getByLabel("Názov plánu").fill(title);
  await page
    .getByLabel("Pridať recept", { exact: true })
    .selectOption(options[0].value);
  await page.getByLabel("Počet porcií", { exact: true }).fill("6");
  await page
    .getByRole("button", {
      name: "Prepočítať ingrediencie – náhľad",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Kontrola prepočtu");
  await page
    .getByRole("button", { name: "Prijať prepočet", exact: true })
    .click();
  const manual = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Manuálna položka" }) });
  await manual.getByLabel("Názov", { exact: true }).fill("Test prací gél");
  await manual
    .getByRole("button", { name: "Pridať manuálnu položku", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Vymeniť recept", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Nový recept")
    .selectOption(options[1].value);
  await page
    .getByRole("button", { name: "Porovnať zmeny", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Test prací gél");
  await page
    .getByRole("button", { name: "Prijať prepočet", exact: true })
    .click();
  await expect(page.getByLabel("Počet porcií", { exact: true })).toHaveValue(
    "6",
  );
  await page
    .getByRole("button", { name: "Uložiť nákupný plán", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Uložené.");
  await expect(page.locator(".planning-dirty")).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: title + " · Rozpracovaný", exact: true })
    .click();
  await expect(
    page.locator(".shopping-line").filter({ hasText: "Test prací gél" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Rohlík nie je pripojený" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV export", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("freezer-nakup.csv");
  const jsonDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSON zadanie pre ChatGPT", exact: true })
    .click();
  expect((await jsonDownload).suggestedFilename()).toBe(
    "freezer-rohlik-zadanie.json",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Pridať domácu surovinu", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Názov", { exact: true })
    .fill("Cibuľa test " + info.project.name);
  await page.getByRole("dialog").getByLabel("Dostupné množstvo").fill("150");
  await page
    .getByRole("button", { name: "Uložiť surovinu", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: new RegExp("Cibuľa test " + info.project.name + " · 150 g"),
    }),
  ).toBeVisible();
});
test("planning API denies anonymous and cross-origin writes", async ({
  request,
}) => {
  const anon = await request.post("/api/planning", {
    headers: { Origin: "http://127.0.0.1:3001" },
    data: {},
  });
  expect(anon.status()).toBe(401);
  const foreign = await request.post("/api/planning", {
    headers: { Origin: "https://invalid.test" },
    data: {},
  });
  expect(foreign.status()).toBe(403);
});

test("culinary planner groups sides, reuses batches and repeat generation is safe", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { createClient } = await import("@supabase/supabase-js");
  const c = createClient(
    process.env.FREEZER_TEST_API_URL!,
    process.env.FREEZER_TEST_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await c.auth.signInWithPassword({
    email: process.env.FREEZER_TEST_EMAIL!,
    password: process.env.FREEZER_TEST_PASSWORD!,
  });
  const tag = info.project.name + " " + randomUUID().slice(0, 6);
  const riceId = randomUUID(),
    mainId = randomUUID();
  const base = {
    portions: 2,
    ingredients: [{ name: "Cibuľa", quantity: 100, unit: "g" }],
    steps: ["Uvariť a bezpečne schladiť."],
    storage: "Rýchlo schladiť.",
    reheating: "Dôkladne prehriať.",
    freezing: true,
    meat: "pork",
  };
  expect(
    (
      await c.rpc("create_recipe_with_id", {
        p_id: riceId,
        p_recipe: {
          ...base,
          name: "Jazmínová ryža — príloha " + tag,
          meal_role: "side",
          allowed_slots: ["lunch", "dinner"],
          side_policy: "none",
        },
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await c.rpc("create_recipe_with_id", {
        p_id: mainId,
        p_recipe: {
          ...base,
          name:
            "Sticky Ginger Pulled Pork — pomaly pečené šťavnaté bravčové " +
            tag,
          meal_role: "main",
          allowed_slots: ["lunch", "dinner"],
          side_policy: "required",
          compatible_side_ids: [riceId],
        },
      })
    ).error,
  ).toBeNull();
  const week = weekMonday(
    2030 +
      [360, 390, 768, 1280, 1440, 1536].indexOf(Number(info.project.name)) +
      "-01-07",
  );
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto("/meal-plan?week=" + week);
  await page
    .getByRole("button", { name: "Navrhnúť týždeň", exact: true })
    .click();
  const ownVersion = (
    await c
      .from("recipe_versions")
      .select("id")
      .eq("recipe_id", mainId)
      .single()
  ).data!.id;
  await page
    .getByLabel("Recepty do návrhu", { exact: true })
    .selectOption([ownVersion]);
  await page
    .getByRole("button", { name: "Zobraziť návrh a rozdiely", exact: true })
    .click();
  const preview = page.getByRole("dialog");
  await expect(preview).toContainText("Skontrolujte zmeny");
  await preview
    .getByLabel("Potvrdzujem uvedené zmeny", { exact: false })
    .check();
  await preview
    .getByRole("button", { name: "Potvrdiť zmeny", exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".planned-meal")).toHaveCount(14);
  const entries = (
    await c
      .from("meal_plan_entries")
      .select("*")
      .gte("meal_date", week)
      .lte("meal_date", week.slice(0, 8) + "31")
  ).data!;
  expect(entries).toHaveLength(14);
  expect(entries.every((e) => e.planned_batch_id)).toBe(true);
  const ids = entries.map((e) => e.id).sort();
  const components = (
    await c.from("meal_plan_components").select("*").in("entry_id", ids)
  ).data!;
  expect(components).toHaveLength(14);
  const batches = (
    await c
      .from("planned_cooking_batches")
      .select("*")
      .in("id", [...new Set(entries.map((e) => e.planned_batch_id))])
  ).data!;
  expect(batches.length).toBeLessThan(14);
  expect(batches.every((b) => Number(b.portions) === 6)).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const widths = await page
    .locator(".planner-day")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeGreaterThan(
    Number(info.project.name) >= 768 ? 500 : 250,
  );
  await page.screenshot({
    path: "test-results/culinary-010-" + info.project.name + ".png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Navrhnúť týždeň", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Zobraziť návrh a rozdiely", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Nie sú žiadne zmeny");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Zrušiť", exact: true })
    .click();
  expect(
    (await c.from("meal_plan_entries").select("id").in("id", ids))
      .data!.map((e) => e.id)
      .sort(),
  ).toEqual(ids);
  await page.getByRole("link", { name: "Vytvoriť nákup", exact: true }).click();
  await page
    .getByRole("button", { name: "Nákup z týždňa (14 jedál)", exact: true })
    .click();
  await expect(page.getByLabel("Názov plánu")).toHaveValue(
    "Nákup z jedálnička",
  );
  expect(
    (
      await c
        .from("cooking_batches")
        .select("id")
        .eq("recipe_version_id", ownVersion)
    ).data,
  ).toEqual([]);
});

test("food cost excludes alcohol/drugstore and physical pantry receipt cannot duplicate", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(
    process.env.FREEZER_TEST_API_URL!,
    process.env.FREEZER_TEST_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({
    email: process.env.FREEZER_TEST_EMAIL!,
    password: process.env.FREEZER_TEST_PASSWORD!,
  });
  const id = randomUUID(),
    token = info.project.name + " " + randomUUID().slice(0, 8),
    merchant = "Rohlík test009 " + token,
    name = "Cibuľa 009 " + token;
  expect(
    (await client.rpc("create_purchase_draft", { p_id: id })).error,
  ).toBeNull();
  const line = (
    n: string,
    category: string,
    total: number,
    ingredient: string | null,
  ) => ({
    name: n,
    category,
    quantity: category === "vegetables" ? 500 : 1,
    unit: category === "vegetables" ? "g" : "ks",
    unit_price_minor: null,
    discount_minor: 0,
    total_minor: total,
    confidence: 1,
    ingredient_name: ingredient,
    product_name: n,
  });
  const data = {
    merchant,
    date: "2040-05-15",
    order_number: randomUUID(),
    currency: "CZK",
    total_minor: 6000,
    items: [
      line(name, "vegetables", 1000, name),
      line("Víno " + token, "alcohol", 2000, null),
      line("Prací gél " + token, "drugstore", 3000, null),
    ],
  };
  expect(
    (
      await client.rpc("save_purchase", {
        p_receipt: id,
        p_request: randomUUID(),
        p_revision: 0,
        p_data: data,
        p_duplicate_confirmed: false,
      })
    ).error,
  ).toBeNull();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto(
    "/food-cost?month=2040-05&merchant=" + encodeURIComponent(merchant),
  );
  await expect(
    page
      .locator("section.card")
      .filter({ has: page.getByText("Potraviny", { exact: true }) })
      .getByRole("heading"),
  ).toContainText("10,00");
  await expect(
    page
      .locator("section.card")
      .filter({ has: page.getByText("Celkové výdavky", { exact: true }) })
      .getByRole("heading"),
  ).toContainText("60,00");
  await page.goto("/shopping");
  await page.getByLabel("Potvrdená účtenka", { exact: true }).selectOption(id);
  await page
    .getByRole("checkbox", { name: name + " · 500 g", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Víno " + token }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Potvrdiť fyzické prevzatie do špajze",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Do špajze prijatých 1 položiek.",
  );
  await expect(
    page.getByRole("button", { name: name + " · 500 g", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Potvrdiť fyzické prevzatie do špajze",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("už bola prevzatá");
  expect(
    (await client.from("pantry_items").select("id").eq("source_receipt_id", id))
      .data,
  ).toHaveLength(1);
});

test("planned recipe snapshot remains readable after revision and archive", async ({
  page,
}, info) => {
  const { createClient } = await import("@supabase/supabase-js");
  const c = createClient(
    process.env.FREEZER_TEST_API_URL!,
    process.env.FREEZER_TEST_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await c.auth.signInWithPassword({
    email: process.env.FREEZER_TEST_EMAIL!,
    password: process.env.FREEZER_TEST_PASSWORD!,
  });
  const name =
      "Snapshot009 " + info.project.name + " " + randomUUID().slice(0, 8),
    recipe = {
      name,
      portions: 2,
      ingredients: [{ name: "Cibuľa", quantity: 300, unit: "g" }],
      steps: ["Pôvodný postup 009."],
      storage: "Pôvodné skladovanie 009.",
      reheating: "Pôvodné ohrievanie 009.",
      meat: "none",
      freezing: true,
    };
  expect(
    (
      await c.rpc("import_recipes", {
        p_import_id: randomUUID(),
        p_recipes: [recipe],
      })
    ).error,
  ).toBeNull();
  const original = (
    await c.from("recipe_versions").select("*").eq("name", name).single()
  ).data!;
  expect(
    (
      await c.rpc("edit_meal_plan", {
        p_request: randomUUID(),
        p_changes: [
          {
            id: randomUUID(),
            recipe_version_id: original.id,
            meal_date: "2060-01-05",
            slot: "lunch",
            portions: 1,
          },
        ],
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await c.rpc("revise_recipe", {
        p_version_id: original.id,
        p_request_id: randomUUID(),
        p_recipe: {
          ...recipe,
          name: name + " nová verzia",
          steps: ["Zmenený postup 009."],
        },
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await c.rpc("archive_recipe", {
        p_recipe_id: original.recipe_id,
        p_request_id: randomUUID(),
      })
    ).error,
  ).toBeNull();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto("/meal-plan/recipe/" + original.id);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.getByText("Pôvodný postup 009.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Zmenený postup 009.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Recept je archivovaný.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("role confirmation creates a new version and preserves original content", async ({
  page,
}, info) => {
  const { createClient } = await import("@supabase/supabase-js");
  const c = createClient(
    process.env.FREEZER_TEST_API_URL!,
    process.env.FREEZER_TEST_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await c.auth.signInWithPassword({
    email: process.env.FREEZER_TEST_EMAIL!,
    password: process.env.FREEZER_TEST_PASSWORD!,
  });
  const id = randomUUID(),
    name =
      "Zeleninová príloha na potvrdenie " +
      info.project.name +
      " " +
      randomUUID().slice(0, 6);
  const original = {
    name,
    portions: 2,
    ingredients: [{ name: "Cvikla", quantity: 300, unit: "g" }],
    steps: ["Upiecť."],
    meat: "none",
    storage: "Schladiť.",
    reheating: "Prehriať.",
    freezing: true,
  };
  expect(
    (await c.rpc("create_recipe_with_id", { p_id: id, p_recipe: original }))
      .error,
  ).toBeNull();
  const before = (
    await c.from("recipe_versions").select("*").eq("recipe_id", id)
  ).data!;
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto("/meal-plan/roles");
  const card = page
    .locator("article")
    .filter({ has: page.locator("strong").filter({ hasText: name }) });
  await card.getByRole("combobox").first().selectOption("vegetable_side");
  await card.getByRole("checkbox").first().check();
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/planning") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: "Potvrdiť vybrané roly — uložiť nové verzie",
      exact: true,
    })
    .click();
  const response = await responsePromise;
  expect(response.request().postDataJSON().data[0].version_id).toBe(
    before[0].id,
  );
  const saved = await response.json();
  expect(saved.error).toBeUndefined();
  expect(
    saved.roleVersions.find((v: { recipe_id: string }) => v.recipe_id === id)
      ?.id,
  ).not.toBe(before[0].id);

  await expect
    .poll(
      async () =>
        (await c.from("recipe_versions").select("id").eq("recipe_id", id)).data
          ?.length,
    )
    .toBe(2);
  const after = (
    await c
      .from("recipe_versions")
      .select("*")
      .eq("recipe_id", id)
      .order("version")
  ).data!;
  expect(after[0]).toEqual(before[0]);
  expect(after[1].metadata.meal_role).toBe("vegetable_side");
  expect(after[1].steps).toEqual(before[0].steps);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
