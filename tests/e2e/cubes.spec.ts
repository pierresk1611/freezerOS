import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
test("trhané mäso → formy → zmrazenie → tri rôzne balíčky → QR → konzumácia", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const client = createClient(
    process.env.FREEZER_TEST_API_URL!,
    process.env.FREEZER_TEST_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({
    email: process.env.FREEZER_TEST_EMAIL!,
    password: process.env.FREEZER_TEST_PASSWORD!,
  });
  const own = (await client.auth.getUser()).data.user!;
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto("/recipes/pulled");
  await expect(
    page.getByRole("heading", {
      name: "Pomaly pečené a trhané mäso",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Potvrdiť pridanie 4 receptov", exact: true })
    .click();
  await expect(page).toHaveURL(/\/recipes\?created=1/);
  await page
    .getByLabel("Kategória", { exact: true })
    .selectOption("slow_roasted_pulled_meat");
  await page.getByRole("button", { name: "Filtrovať", exact: true }).click();
  await expect(page).toHaveURL(/category=slow_roasted_pulled_meat/);
  for (const seedName of [
    "Sticky Ginger Pulled Pork",
    "Trhané hovädzie na červenom víne",
    "Mexické Carnitas s kukuricou",
    "BBQ Pulled Chicken",
  ])
    await expect(
      page.getByRole("heading", { name: seedName, exact: true }),
    ).toBeVisible();
  const source = await client
    .from("recipe_latest")
    .select("*")
    .eq("name", "Sticky Ginger Pulled Pork")
    .single();
  expect(source.data.metadata.oven_c).toBe(150);
  const id = randomUUID(),
    name = "Trhané mäso test " + info.project.name + " " + id.slice(0, 6);
  await client.rpc("create_recipe_with_id", {
    p_id: id,
    p_recipe: {
      name,
      portions: 3,
      ingredients: [{ name: "Bravčové pliecko", quantity: 1500, unit: "g" }],
      steps: ["Pomaly piecť do zmäknutia."],
      reheating: "Prehriať.",
      category: "slow_roasted_pulled_meat",
      cooking_method: "slow_roast",
      oven_c: 150,
      prep_minutes: 20,
      cooking_minutes_min: 240,
      cooking_minutes_max: 300,
      meat: "pork",
    },
  });
  const molds = await client
    .from("portion_molds")
    .insert([
      {
        user_id: own.id,
        name: "Test 250 " + id,
        cells: 4,
        cell_ml: 250,
        owned_count: 1,
      },
      {
        user_id: own.id,
        name: "Test 500 " + id,
        cells: 2,
        cell_ml: 500,
        owned_count: 1,
      },
    ])
    .select("*");
  const small = molds.data!.find((m) => m.cell_ml === 250)!.id,
    large = molds.data!.find((m) => m.cell_ml === 500)!.id;
  await page.goto(
    "/portioning?version=" +
      (
        await client
          .from("recipe_latest")
          .select("id")
          .eq("recipe_id", id)
          .single()
      ).data!.id,
  );
  await expect(
    page.getByRole("heading", { name: "Formy a porciovanie", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Hmotnosť porciovaného jedla (g)", { exact: true })
    .fill("1200");
  await page
    .getByLabel("Skutočné náklady porciovaného obsahu (Kč)", { exact: true })
    .fill("120,01");
  await page
    .getByLabel("Orientačný dátum zachovania kvality", { exact: true })
    .fill("2026-12-01");
  const weights = [200, 200, 100, 400, 300],
    volumes = [250, 250, 125, 450, 300];
  for (let i = 0; i < 5; i++) {
    if (i)
      await page
        .getByRole("button", { name: "Pridať kocku", exact: true })
        .click();
    await page
      .getByLabel(`Forma kocky ${i + 1}`, { exact: true })
      .selectOption(i < 3 ? small : large);
    await page
      .getByLabel(`Hmotnosť kocky ${i + 1} (g)`, { exact: true })
      .fill(String(weights[i]));
    await page
      .getByLabel(`Objem kocky ${i + 1} (ml)`, { exact: true })
      .fill(String(volumes[i]));
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("portioning-cubes.png"),
    caret: "initial",
  });
  await page
    .getByRole("button", {
      name: "Uložiť várku a kocky na zmrazenie",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/portioning$/);
  const batch = (
    await client
      .from("cooking_batches")
      .select("*")
      .eq(
        "recipe_version_id",
        (
          await client
            .from("recipe_latest")
            .select("id")
            .eq("recipe_id", id)
            .single()
        ).data!.id,
      )
      .single()
  ).data!;
  expect(
    (
      await client
        .from("inventory_packages")
        .select("*")
        .eq("batch_id", batch.id)
    ).data,
  ).toHaveLength(0);
  const panel = page.getByRole("heading", { name, exact: true }).locator("..");
  await panel
    .getByRole("button", { name: "Kocky sú zmrazené", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Rozdeliť do vákuových balíčkov",
      exact: true,
    }),
  ).toBeVisible();
  for (const [i, bag] of [0, 0, 1, 1, 2].entries())
    await panel
      .getByLabel(`Balíček kocky ${i + 1}`, { exact: true })
      .selectOption(String(bag));
  await panel.getByLabel("Porcie v balíčku 1", { exact: true }).fill("1");
  await panel.getByLabel("Porcie v balíčku 2", { exact: true }).fill("1.5");
  await panel.getByLabel("Porcie v balíčku 3", { exact: true }).fill("0.5");
  await page.screenshot({
    path: info.outputPath("vacuum-preview.png"),
    caret: "initial",
  });
  await panel
    .getByRole("button", {
      name: "Potvrdiť vákuovanie a príjem do mrazničky",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/inventory$/);
  const packages = (
    await client.from("inventory_packages").select("*").eq("batch_id", batch.id)
  ).data!;
  expect(packages).toHaveLength(3);
  expect(packages.map((p) => p.initial_g).sort()).toEqual([300, 400, 500]);
  expect(packages.reduce((s, p) => s + Number(p.cost_minor), 0)).toBe(12001);
  await page.goto("/labels/" + packages[0].id);
  const png = await page.request.get(
    "/api/labels/" + packages[0].id + "?format=png",
  );
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");
  const pdf = await page.request.get(
    "/api/labels/" + packages[0].id + "?format=pdf",
  );
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  const pkg = packages.find((p) => p.initial_g === 400)!;
  await page.goto("/inventory?id=" + pkg.id);
  await page.getByText("Zjesť porciu", { exact: true }).click();
  await page.getByLabel("Množstvo (g)", { exact: true }).fill("200");
  await page
    .getByRole("button", { name: "Potvrdiť konzumáciu", exact: true })
    .click();
  await expect(
    page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .getByText("200 g", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await client
        .from("inventory_packages")
        .select("remaining_g")
        .eq("batch_id", batch.id)
    ).data!.reduce((s, p) => s + p.remaining_g, 0),
  ).toBe(1000);
  await page.goto("/preferences");
  await page
    .getByRole("button", { name: "Uložiť moje chute", exact: true })
    .click();
  await expect(page.getByText("Preferencie boli uložené.")).toBeVisible();
  await page.goto("/meal-plan");
  await page.getByLabel("Recept", { exact: true }).selectOption(source.data.id);
  await page
    .getByRole("button", { name: "Pridať do jedálnička", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Jedálniček na 7 dní", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
