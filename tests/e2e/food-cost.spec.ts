import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
test("účtenka → dokumenty → kontrola → nákup → oprava → cenová história → storno", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(20000);
  const merchant =
    "Test Food " + info.project.name + " " + randomUUID().slice(0, 8);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto("/food-cost/receipts/new");
  await page.getByRole("button", { name: "Vytvoriť pracovný návrh" }).click();
  await expect(page).toHaveURL(/\/food-cost\/receipts\/[a-f0-9-]+$/);
  const url = page.url();
  await expect(
    page.getByText("Automatické rozpoznávanie nie je nakonfigurované.", {
      exact: false,
    }),
  ).toBeVisible();
  const png = await sharp({
    create: {
      width: 350 + Number(info.project.name),
      height: 600,
      channels: 3,
      background: "#fff",
    },
  })
    .png()
    .toBuffer();
  const jpg = await sharp({
    create: {
      width: 350 + Number(info.project.name),
      height: 600,
      channels: 3,
      background: "#ddd",
    },
  })
    .jpeg()
    .toBuffer();
  const pdf = await PDFDocument.create();
  pdf.setTitle(merchant);
  pdf.addPage();
  pdf.addPage();
  const pdfBytes = Buffer.from(await pdf.save());
  for (const [name, mime, buffer] of [
    ["test.png", "image/png", png],
    ["test.jpg", "image/jpeg", jpg],
    ["test.pdf", "application/pdf", pdfBytes],
  ] as const) {
    await page
      .getByLabel("Nahrať účtenku", { exact: true })
      .setInputFiles({ name, mimeType: mime, buffer });
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await page.getByLabel("Obchod", { exact: true }).fill(merchant);
  await page.getByLabel("Dátum nákupu").fill("2026-10-14");
  await page.getByLabel("Číslo objednávky").fill(merchant + "-order");
  await page.getByLabel("Zaplatené spolu (CZK)", { exact: true }).fill("200");
  let row = page.locator(".receipt-line").nth(0);
  await row.getByLabel("Produkt", { exact: true }).fill("Hovězí kližka");
  await row.getByLabel("Množstvo", { exact: true }).fill("500");
  await row.getByLabel("Jednotka", { exact: true }).selectOption("g");
  await row.getByLabel("Jednotková cena (CZK)", { exact: true }).fill("400");
  await row.getByLabel("Zľava (CZK)", { exact: true }).fill("10");
  await row.getByLabel("Celkom po zľave (CZK)", { exact: true }).fill("190");
  await row.getByLabel("Normalizovaný produkt").fill("Kližka " + merchant);
  await row.getByLabel("Mapovanie na surovinu").fill("Hovädzia kližka");
  await page
    .getByRole("button", { name: "Pridať položku", exact: true })
    .click();
  row = page.locator(".receipt-line").nth(1);
  await row.getByLabel("Produkt", { exact: true }).fill("Vákuové sáčky");
  await row.getByLabel("Celkom po zľave (CZK)", { exact: true }).fill("20");
  await expect(row.getByLabel("Kategória", { exact: true })).toHaveValue(
    "equipment",
  );
  await page
    .getByRole("button", { name: "Pridať položku", exact: true })
    .click();
  row = page.locator(".receipt-line").nth(2);
  await row.getByLabel("Produkt", { exact: true }).fill("Vratka zeleniny");
  await row.getByLabel("Celkom po zľave (CZK)", { exact: true }).fill("-10");
  await row.getByLabel("Kategória", { exact: true }).selectOption("vegetables");
  await expect(
    page.getByRole("button", { name: "Potvrdiť nákup", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Zaplatené spolu (CZK)", { exact: true }).fill("201");
  await expect(
    page.getByRole("button", { name: "Potvrdiť nákup", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Rozdiel:", { exact: false })).toBeVisible();
  await page.getByLabel("Zaplatené spolu (CZK)", { exact: true }).fill("200");
  await page.getByRole("button", { name: "Uložiť pracovný návrh" }).click();
  await expect(
    page.getByText("Pracovný návrh je uložený", { exact: false }),
  ).toContainText("Pracovný návrh je uložený");
  await page.reload();
  await expect(page.getByLabel("Obchod", { exact: true })).toHaveValue(
    merchant,
  );
  await expect(page.locator(".receipt-line")).toHaveCount(3);
  await page.screenshot({
    path: `test-results/receipt-review-${info.project.name}.png`,
    fullPage: true,
    caret: "initial",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Potvrdiť nákup", exact: true })
    .click();
  await expect(page).toHaveURL(/\/food-cost$/);
  await page.getByLabel("Obchod", { exact: true }).selectOption(merchant);
  await page.getByLabel("Mesiac a rok").fill("2026-10");
  await page.getByRole("button", { name: "Filtrovať", exact: true }).click();
  await expect(
    page.getByText("180,00", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("200,00", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.locator(".recharts-surface")).toHaveCount(5);
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await page.screenshot({
    path: `test-results/food-dashboard-${info.project.name}.png`,
    fullPage: true,
    caret: "initial",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Opraviť nákup" }),
  ).toBeVisible();
  await page.getByLabel("Zaplatené spolu (CZK)", { exact: true }).fill("180");
  await page
    .locator(".receipt-line")
    .first()
    .getByLabel("Celkom po zľave (CZK)", { exact: true })
    .fill("170");
  await page.getByRole("button", { name: "Uložiť opravu nákupu" }).click();
  await expect(page).toHaveURL(/\/food-cost$/);
  await page.goto("/food-cost/prices");
  await page
    .getByLabel("Mapovaná surovina alebo produkt")
    .selectOption("Hovädzia kližka");
  await page.getByRole("button", { name: "Zobraziť históriu" }).click();
  await expect(
    page.getByRole("heading", { name: "Zaplatená cena Kč/kg po zľavách" }),
  ).toBeVisible();
  await page.goto(url);
  await page
    .getByRole("button", { name: "Stornovať nákup", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Potvrdiť storno", exact: true })
    .click();
  await expect(page).toHaveURL(/\/food-cost$/);
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "Uložiť opravu nákupu" }),
  ).toBeDisabled();
});

test("manuálny nákup bez dokumentu, rozpočet a ochrana API", async ({
  page,
  request,
}, info) => {
  const merchant = `Manual ${info.project.name} ${randomUUID().slice(0, 8)}`;
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrý deň, čo si dáme?" }),
  ).toBeVisible();
  await page.goto("/food-cost/receipts/new");
  await page.getByRole("button", { name: "Vytvoriť pracovný návrh" }).click();
  await expect(page).toHaveURL(/\/receipts\/[a-f0-9-]+$/);
  const id = page.url().split("/").at(-1),
    origin = new URL(page.url()).origin;
  expect(
    (
      await request.post("/api/food-cost", {
        headers: { origin },
        data: { action: "create", id: randomUUID() },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post("/api/food-cost", {
        headers: { origin: "https://other.invalid" },
        data: { action: "recognize", id, consent: true },
      })
    ).status(),
  ).toBe(403);
  const consent = await page.request.post("/api/food-cost", {
    headers: { origin },
    data: { action: "recognize", id, consent: false },
  });
  expect(consent.status()).toBe(400);
  expect((await consent.json()).error).toContain("súhlas");
  await page.getByLabel("Obchod", { exact: true }).fill(merchant);
  await page.getByLabel("Dátum nákupu").fill("2026-10-15");
  await page.getByLabel("Zaplatené spolu (CZK)", { exact: true }).fill("25.50");
  const row = page.locator(".receipt-line").first();
  await row.getByLabel("Produkt", { exact: true }).fill("Mrkva " + merchant);
  await row.getByLabel("Celkom po zľave (CZK)", { exact: true }).fill("25.50");
  await expect(
    page.getByRole("button", { name: "Potvrdiť nákup", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Potvrdiť nákup", exact: true })
    .click();
  await expect(page).toHaveURL(/\/food-cost$/);
  await page.goto("/food-cost/budget?month=2026-10");
  await page.getByLabel("Rozpočet v CZK").fill("1000.50");
  await page.getByRole("button", { name: "Uložiť rozpočet" }).click();
  await expect(page.getByText("Rozpočet:", { exact: false })).toContainText(
    "1 000,50",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
