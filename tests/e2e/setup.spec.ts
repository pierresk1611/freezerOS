import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
test("recept → várka → sklad → konzumácia", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/recipes");
  await page.getByText("+ Nový recept", { exact: true }).click();
  const editor = page
    .locator("details")
    .filter({ has: page.getByText("+ Nový recept", { exact: true }) });
  const name = "Guláš " + randomUUID();
  await editor.getByLabel("Názov", { exact: true }).fill(name);
  await editor.getByLabel("Názov suroviny").fill("Hovädzie mäso");
  await editor
    .getByLabel("Postup — jeden krok na riadok")
    .fill("Orestovať cibuľu.\nMäso dusiť do mäkka.");
  await editor.getByLabel("Postup zohrievania").fill("Dôkladne prehriať.");
  await editor.getByRole("button", { name: "Uložiť recept" }).click();
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card).toBeVisible();
  await card.getByText("Navariť novú várku", { exact: true }).click();
  await card.getByLabel("Výsledná hmotnosť (g)").fill("1000");
  await card.getByLabel("Celkové náklady (Kč)").fill("278.01");
  await card.getByLabel("Odporúčaná spotreba pre kvalitu").fill("2027-01-01");
  await card.getByRole("button", { name: "Vytvoriť várku a zásoby" }).click();
  await expect(page).toHaveURL(/inventory/);
  const pack = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .first();
  await expect(pack.getByText("500 g", { exact: true })).toBeVisible();
  await pack.getByText("Zjesť porciu", { exact: true }).click();
  await pack.getByLabel("Množstvo (g)").fill("200");
  await pack.getByRole("button", { name: "Potvrdiť konzumáciu" }).click();
  await expect(
    page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .filter({ hasText: "300 g" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "História konzumácie" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("inventory.png"),
    fullPage: true,
  });
});

test("PWA offline obrazovka neukladá súkromné dáta", async ({ page }) => {
  await page.goto("/login");
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  const icon = await page.request.get("/icon");
  expect(icon.headers()["content-type"]).toContain("image/png");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  const cached = await page.evaluate(async () => {
    const cache = await caches.open("freezer-public-v1");
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  expect(cached.sort()).toEqual(["/icon.svg", "/offline.html"]);
  await page.context().setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ste bez pripojenia" }),
  ).toBeVisible();
  await page.context().setOffline(false);
});
