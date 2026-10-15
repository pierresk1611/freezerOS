import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import plan from "../../docs/seed-corrections/storage-reheating-v1.json" with { type: "json" };
import seed from "../../docs/seed-recipes.json" with { type: "json" };
test("obsahová oprava vytvorí novú verziu, zachová várku a chráni používateľské úpravy", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const index = [360, 390, 768, 1280, 1440, 1536].indexOf(Number(info.project.name));
  const item = plan.items[index],
    modified = plan.items[index + 5];
  const client = createClient(
    process.env.FREEZER_TEST_API_URL!,
    process.env.FREEZER_TEST_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const signed = await client.auth.signInWithPassword({
    email: process.env.FREEZER_TEST_EMAIL!,
    password: process.env.FREEZER_TEST_PASSWORD!,
  });
  expect(signed.error).toBeNull();
  const original = await client
    .from("recipe_latest")
    .select("*")
    .eq("name", item.key)
    .single();
  expect(original.error).toBeNull();
  const batchRequest = randomUUID();
  const batch = await client.rpc("create_batch", {
    p_version_id: original.data.id,
    p_request_id: batchRequest,
    p_weight_g: 1000,
    p_package_count: 2,
    p_cost_minor: 12345,
    p_best_before: "2027-01-01",
  });
  expect(batch.error).toBeNull();
  const other = await client
    .from("recipe_latest")
    .select("*")
    .eq("name", modified.key)
    .single();
  expect(other.error).toBeNull();
  const ownName = modified.key + " – moja úprava";
  const changed = await client.rpc("revise_recipe", {
    p_version_id: other.data.id,
    p_request_id: randomUUID(),
    p_recipe: { ...modified.before, name: ownName, portions: 3 },
  });
  expect(changed.error).toBeNull();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(process.env.FREEZER_TEST_EMAIL!);
  await page
    .getByLabel("Heslo", { exact: true })
    .fill(process.env.FREEZER_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Prihlásiť sa", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/recipes/corrections");
  const section = page.locator("section.card").filter({
    has: page.getByRole("heading", { name: item.key, exact: true }),
  });
  await expect(
    section.getByText(item.before.reheating, { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByText(item.after.reheating, { exact: true }),
  ).toBeVisible();
  const manual = page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { name: ownName, exact: true }) });
  await expect(
    manual.getByRole("button", { name: "Potvrdiť opravu ako novú verziu" }),
  ).toHaveCount(0);
  await expect(
    manual.getByRole("link", { name: "Skontrolovať a upraviť individuálne" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await section
    .getByRole("button", {
      name: "Potvrdiť opravu ako novú verziu",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Oprava bola uložená ako nová verzia.",
  );
  const latest = await client
    .from("recipe_latest")
    .select("*")
    .eq("recipe_id", original.data.recipe_id)
    .single();
  expect(latest.data.version).toBe(2);
  expect(latest.data.storage).toBe(item.after.storage);
  expect(latest.data.reheating).toBe(item.after.reheating);
  expect(latest.data.ingredients).toEqual(item.before.ingredients);
  const history = await client
    .from("recipe_versions")
    .select("*")
    .eq("id", original.data.id)
    .single();
  expect(history.data.storage).toBe(item.before.storage);
  expect(history.data.reheating).toBe(item.before.reheating);
  const batches = await client
    .from("cooking_batches")
    .select("*")
    .eq("recipe_version_id", original.data.id);
  expect(batches.data).toHaveLength(1);
  expect(batches.data![0].cost_minor).toBe(12345);
  const untouched = await client
    .from("recipe_latest")
    .select("*")
    .eq("recipe_id", other.data.recipe_id)
    .single();
  expect(untouched.data.version).toBe(2);
  expect(untouched.data.name).toBe(ownName);
  expect(untouched.data.reheating).toBe(modified.before.reheating);
  await page.goto("/recipes/import");
  await page
    .getByRole("button", {
      name: "Zobraziť 15 predvolených šablón v náhľade",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Náhľad všetkých 15 receptov" }),
  ).toBeVisible();
  await expect(page.locator(".import-row.invalid")).toHaveCount(15);
  await page
    .getByRole("button", { name: "Importovať vybrané recepty", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Pridané: 0");
  await expect(
    page.getByRole("region", { name: "Výsledok importu" }),
  ).toContainText("Chybné: 15");
  expect(
    (await client.from("recipe_versions").select("id").eq("name", item.key))
      .data,
  ).toHaveLength(2);
  expect(
    (await client.from("recipe_versions").select("id").eq("name", modified.key))
      .data,
  ).toHaveLength(1);
  const requests = await client
    .from("operation_requests")
    .select("id")
    .eq("id", seed.importId);
  expect(requests.data).toHaveLength(1);
});
