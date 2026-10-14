import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function login(page: Page) {
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
async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.documentElement &&
          document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}
test("galéria, samostatný editor, verzia, cooking mode, duplikácia a archív", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await login(page);
  await page.goto("/recipes");
  await page.getByRole("link", { name: "Nový recept", exact: true }).click();
  await expect(page).toHaveURL(/\/recipes\/new$/);
  await page
    .getByRole("button", { name: "Uložiť recept", exact: true })
    .click();
  await expect(
    page.getByText("Zadajte názov s 2 až 160 znakmi."),
  ).toBeVisible();
  const name = "Chicken teriyaki · " + randomUUID().slice(0, 8);
  await page.getByLabel("Názov", { exact: true }).fill(name);
  await page
    .getByLabel("Názov suroviny 1", { exact: true })
    .fill("Kuracie mäso");
  await page.getByLabel("Druh mäsa", { exact: true }).selectOption("chicken");
  await page
    .getByRole("button", { name: "Pridať surovinu", exact: true })
    .click();
  await page.getByLabel("Názov suroviny 2", { exact: true }).fill("Ryža");
  await page
    .getByLabel("Krok 1", { exact: true })
    .fill("Mäso prudko orestujte.");
  await page.getByRole("button", { name: "Pridať krok", exact: true }).click();
  await page
    .getByLabel("Krok 2", { exact: true })
    .fill("Najprv prepláchnite ryžu.");
  await page
    .getByRole("button", { name: "Posunúť krok 2 hore", exact: true })
    .click();
  await expect(page.getByLabel("Krok 1", { exact: true })).toHaveValue(
    "Najprv prepláchnite ryžu.",
  );
  await page
    .getByLabel("Postup zohrievania", { exact: true })
    .fill("Dôkladne prehrejte.");
  await noOverflow(page);
  await page.screenshot({
    caret: "initial",
    path: info.outputPath("editor.png"),
  });
  await page
    .getByRole("button", { name: "Uložiť recept", exact: true })
    .click();
  await expect(page).toHaveURL(/\/recipes\?created=1$/);
  await page.getByLabel("Hľadať recept").fill(name);
  await page.getByRole("button", { name: "Filtrovať", exact: true }).click();
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card).toBeVisible();
  await expect(card.locator("textarea")).toHaveCount(0);
  const columns = await page
    .locator(".recipe-gallery")
    .evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
  expect(columns).toBe(
    Number(info.project.name) >= 1400
      ? 3
      : Number(info.project.name) >= 768
        ? 2
        : 1,
  );
  await noOverflow(page);
  await page.screenshot({
    caret: "initial",
    path: info.outputPath("gallery.png"),
  });
  await card.getByRole("link", { name: "Otvoriť recept", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]+$/);
  const detailUrl = page.url();
  await noOverflow(page);
  await page.getByRole("link", { name: "Upraviť recept", exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel("Názov", { exact: true }).fill(name + " v2");
  await page
    .getByRole("button", { name: "Odstrániť surovinu 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Uložiť novú verziu", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: name + " v2", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/VERZIA 2/)).toBeVisible();
  await page.screenshot({
    caret: "initial",
    path: info.outputPath("detail.png"),
  });
  await page.getByRole("link", { name: "Upraviť recept", exact: true }).click();
  await page.getByLabel("Názov", { exact: true }).fill("Neuložená zmena");
  await page.getByRole("link", { name: "Zrušiť", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: name + " v2", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Režim varenia", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Najprv prepláchnite ryžu.",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ďalší krok", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Mäso prudko orestujte.", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Predchádzajúci", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Najprv prepláchnite ryžu.",
      exact: true,
    }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    caret: "initial",
    path: info.outputPath("cooking.png"),
  });
  await page.getByRole("button", { name: "Ďalší krok", exact: true }).click();
  await page.getByRole("button", { name: "Dokončiť", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hotovo. Dobrú chuť!", exact: true }),
  ).toBeVisible();
  await page.goto(detailUrl);
  await page.getByRole("link", { name: "Duplikovať", exact: true }).click();
  await expect(page).toHaveURL(/\/recipes\/new\?from=/);
  await page.getByLabel("Názov", { exact: true }).fill(name + " kópia");
  await page
    .getByRole("button", { name: "Uložiť recept", exact: true })
    .click();
  await page.getByLabel("Hľadať recept").fill(name + " kópia");
  await page.getByRole("button", { name: "Filtrovať", exact: true }).click();
  const copy = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: name + " kópia", exact: true }),
  });
  await expect(copy).toBeVisible();
  await copy.getByLabel("Možnosti receptu " + name + " kópia").click();
  await copy.getByRole("button", { name: "Archivovať", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Potvrdiť archiváciu", exact: true })
    .click();
  await expect(page).toHaveURL(/\/recipes$/);
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("Hľadať recept").fill(name + " kópia");
  await page.getByRole("button", { name: "Filtrovať", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.goto(detailUrl);
  await expect(
    page.getByRole("heading", { name: name + " v2", exact: true }),
  ).toBeVisible();
  await page.goto("/recipes");
  await page.getByLabel("Hľadať recept").fill(name);
  await page.getByLabel("Druh mäsa", { exact: true }).selectOption("beef");
  await page.getByRole("button", { name: "Filtrovať", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await noOverflow(page);
});
