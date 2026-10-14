import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
test.use({ serviceWorkers: "block" });
test("fotografie: upload, hlavná, poradie, náhrada, detail, izolácia a odstránenie", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const fixture = createClient(
    process.env.FREEZER_TEST_API_URL!,
    process.env.FREEZER_TEST_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await fixture.auth.signInWithPassword({
    email: process.env.FREEZER_TEST_EMAIL!,
    password: process.env.FREEZER_TEST_PASSWORD!,
  });
  const id = randomUUID(),
    name = "Foto recept " + id.slice(0, 8);
  const created = await fixture.rpc("create_recipe_with_id", {
    p_id: id,
    p_recipe: {
      name,
      portions: 2,
      ingredients: [{ name: "Mrkva", quantity: 100, unit: "g" }],
      steps: ["Uvarte."],
      reheating: "Prehrejte.",
    },
  });
  expect(created.error).toBeNull();
  const png = await sharp({
    create: { width: 100, height: 80, channels: 3, background: "#a35232" },
  })
    .png()
    .toBuffer();
  const file = { name: "meal.png", mimeType: "image/png", buffer: png };
  const user = (await fixture.auth.getUser()).data.user!;
  try {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
    await page
      .getByLabel("Heslo", { exact: true })
      .fill(process.env.FREEZER_TEST_PASSWORD!);
    await page
      .getByRole("button", { name: "Prihlásiť sa", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
    ).toBeVisible();
    await page.goto(`/recipes/${id}/edit`);
    await page.getByLabel("Vybrať fotografie", { exact: true }).setInputFiles({
      name: "bad.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    });
    await expect(page.getByText(/Použite JPG/)).toBeVisible();
    await page.getByLabel("Vybrať fotografie", { exact: true }).setInputFiles({
      name: "too-big.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
    await expect(
      page.getByText("Fotografia môže mať najviac 10 MB."),
    ).toBeVisible();
    await page
      .getByLabel("Vybrať fotografie", { exact: true })
      .setInputFiles([file, { ...file, name: "second.png" }]);
    await expect(page.locator(".photo-item")).toHaveCount(2);
    await expect(page.getByText("Fotografie boli uložené.")).toBeVisible();
    const privatePhotos = await page.request.get(`/api/recipes/${id}/photos`);
    expect(privatePhotos.status()).toBe(200);
    expect(privatePhotos.headers()["cache-control"]).toContain("no-store");
    const forged = await page.request.patch(`/api/recipes/${id}/photos`, {
      headers: { Origin: "https://example.invalid" },
      data: { revision: 2, photos: [] },
    });
    expect(forged.status()).toBe(403);

    await page
      .locator(".photo-item")
      .nth(1)
      .getByLabel("Alternatívny text")
      .fill("Druhý záber");
    await page
      .locator(".photo-item")
      .nth(1)
      .getByRole("button", { name: "Uložiť popis" })
      .click();
    await expect(
      page.getByText("Zmena fotografií bola uložená."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Nastaviť ako hlavnú" }).click();
    await expect(
      page.locator(".photo-item").first().getByLabel("Alternatívny text"),
    ).toHaveValue("Druhý záber");
    await page.getByLabel("Fotografiu 1 dole").click();
    await expect(
      page.locator(".photo-item").nth(1).getByLabel("Alternatívny text"),
    ).toHaveValue("Druhý záber");
    await page
      .getByLabel("Nahradiť fotografiu 1", { exact: true })
      .setInputFiles(file);
    await expect(page.locator(".photo-item")).toHaveCount(2);
    await expect(
      page.getByText("Zmena fotografií bola uložená."),
    ).toBeVisible();
    await page.goto(`/recipes/${id}`);
    await expect(page.locator(".recipe-media img")).toBeVisible();

    await expect
      .poll(() =>
        page
          .locator(".recipe-media img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Zobraziť fotografiu 2" }).click();
    await expect(page.locator(".recipe-media img")).toHaveAttribute(
      "alt",
      "Druhý záber",
    );
    await page.getByRole("button", { name: "Zväčšiť fotografiu" }).click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await page.getByRole("button", { name: "Zavrieť fotografiu" }).click();
    await page.screenshot({
      path: info.outputPath("recipe-photos-detail.png"),
      caret: "initial",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.goto(`/recipes?q=${encodeURIComponent(name)}`);
    await expect(page.locator(".recipe-tile .recipe-media img")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".recipe-tile .recipe-media img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.screenshot({
      path: info.outputPath("recipe-photos-gallery.png"),
      caret: "initial",
    });
    // A missing/expired image gives a clear fallback, without a broken-image icon.
    await page.route("**/storage/v1/object/sign/**", (r) => r.abort());
    await page.goto(`/recipes/${id}`);
    await page.evaluate(() => {
      const image =
        document.querySelector<HTMLImageElement>(".recipe-media img");
      if (image) image.src += "&missing-test=" + Date.now();
    });
    await expect(
      page.locator(".recipe-media .recipe-placeholder"),
    ).toContainText("Fotografia nie je dostupná");
    await page.unroute("**/storage/v1/object/sign/**");
    await page.goto(`/recipes/${id}/edit`);
    page.on("dialog", (d) => d.accept());
    await page
      .locator(".photo-item")
      .first()
      .getByRole("button", { name: "Odstrániť", exact: true })
      .click();
    await expect(page.locator(".photo-item")).toHaveCount(1);
    await page
      .locator(".photo-item")
      .first()
      .getByRole("button", { name: "Odstrániť", exact: true })
      .click();
    await expect(page.locator(".photo-item")).toHaveCount(0);
    const versions = await fixture
      .from("recipe_versions")
      .select("*")
      .eq("recipe_id", id);
    expect(versions.data).toHaveLength(1);
    expect(versions.data![0].version).toBe(1);
  } finally {
    const files = await fixture.storage
      .from("recipe-photos")
      .list(`${user.id}/${id}`);
    for (const folder of files.data ?? []) {
      await fixture.storage
        .from("recipe-photos")
        .remove([
          `${user.id}/${id}/${folder.name}/large.webp`,
          `${user.id}/${id}/${folder.name}/thumb.webp`,
        ]);
    }
  }
});
test("nový recept: náhľad pred uložením a upload po vytvorení", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto("/recipes/new");
  const name = "Nový s fotografiou " + randomUUID().slice(0, 8);
  await page.getByLabel("Názov", { exact: true }).fill(name);
  await page.getByLabel("Názov suroviny 1", { exact: true }).fill("Mrkva");
  await page.getByLabel("Krok 1", { exact: true }).fill("Uvarte.");
  await page
    .getByLabel("Postup zohrievania", { exact: true })
    .fill("Prehrejte.");
  const png = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#753" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Vybrať fotografie", { exact: true })
    .setInputFiles({ name: "meal.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".photo-item img")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await page
    .getByLabel("Alternatívny text", { exact: true })
    .fill("Moja mrkva");
  await page
    .getByRole("button", { name: "Uložiť recept", exact: true })
    .click();
  await expect(page).toHaveURL(/\/recipes\?created=1/);
  await page.getByLabel("Hľadať recept", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Filtrovať" }).click();
  await expect(page.locator(".recipe-tile img")).toHaveAttribute(
    "alt",
    "Moja mrkva",
  );
});

test("importovaný recept: výber fotografie funguje aj po chybe načítania", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  const client = createClient(
    process.env.FREEZER_TEST_API_URL!,
    process.env.FREEZER_TEST_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({
    email: process.env.FREEZER_TEST_EMAIL!,
    password: process.env.FREEZER_TEST_PASSWORD!,
  });
  const recipes = await client
    .from("recipe_latest")
    .select("recipe_id")
    .limit(1);
  const id = recipes.data![0].recipe_id;
  await page.route(`**/api/recipes/${id}/photos`, async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          message:
            "Fotografie nie sú dostupné. Skontrolujte databázovú migráciu.",
        }),
      });
    else await route.continue();
  });
  await page.goto(`/recipes/${id}/edit`);
  await expect(
    page.getByText(
      "Fotografie nie sú dostupné. Skontrolujte databázovú migráciu.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pridať fotografiu", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Odfotiť jedlo", exact: true }),
  ).toBeEnabled();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Pridať fotografiu", exact: true })
    .click();
  expect((await chooser).isMultiple()).toBe(true);
  await page.unroute(`**/api/recipes/${id}/photos`);
  await page
    .getByRole("button", {
      name: "Skúsiť načítať fotografie znova",
      exact: true,
    })
    .click();
  await expect(page.getByText("Fotografie boli načítané.")).toBeVisible();
  await expect(page.locator(".photo-manager").getByRole("alert")).toHaveCount(
    0,
  );
});
