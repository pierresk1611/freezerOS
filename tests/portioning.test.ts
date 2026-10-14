import { it, expect } from "vitest";
import {
  balanceCubes,
  allocateCosts,
  softPreferenceScore,
} from "../src/lib/portioning";
import { recipeSchema, importSchema, recommend } from "../src/lib/domain";
import seed from "../docs/pulled-recipes.json";
import { packageLabel } from "../src/lib/package-label";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import jsQR from "jsqr";
it("keeps grams and ml independent", () => {
  expect(
    balanceCubes(
      [
        { weight_g: 200, volume_ml: 250 },
        { weight_g: 400, volume_ml: 500 },
      ],
      600,
    ),
  ).toEqual({ grams: 600, ml: 750, valid: true });
  expect(balanceCubes([{ weight_g: 200, volume_ml: 250 }], 250).valid).toBe(
    false,
  );
});
it("allocates every minor unit across unequal packages and preserves unknown costs", () => {
  expect(allocateCosts(12001, [400, 500, 300])).toEqual([4000, 5000, 3001]);
  expect(allocateCosts(null, [400, 500, 300])).toEqual([null, null, null]);
  expect(() => allocateCosts(2, [0, 1])).toThrow();
});
it("validates complete pulled templates without fake pricing or nutrition", () => {
  expect(importSchema.safeParse(seed).success).toBe(true);
  expect(seed.payload).toHaveLength(4);
  for (const r of seed.payload) {
    expect(recipeSchema.parse(r).category).toBe("slow_roasted_pulled_meat");
    expect(r.ingredients.length).toBeGreaterThan(9);
    expect(r.steps.length).toBeGreaterThan(5);
    expect(r.storage).not.toContain("90");
    expect(r).not.toHaveProperty("cost");
    expect(r).not.toHaveProperty("kcal");
  }
  expect(seed.payload[3].steps.join(" ")).toContain("74 °C");
});
it("soft preferences affect ordering but never exclude other available food", () => {
  const r = seed.payload[0];
  expect(
    softPreferenceScore(r, ["Trhané bravčové", "Kukurica"], []),
  ).toBeGreaterThan(0);
  expect(softPreferenceScore(r, [], [])).toBe(0);
  const pkg = {
    id: "x",
    name: r.name,
    remaining_g: 100,
    initial_g: 100,
    cost_minor: null,
    best_before: null,
    created_at: "2026-10-14",
    location_id: null,
  };
  expect(recommend([pkg], [], new Date(), {})).not.toBeNull();
});
it("exports complete PNG with readable QR and correctly sized PDF", async () => {
  const id = crypto.randomUUID(),
    origin = "https://freezer-os.vercel.app";
  const p = {
    id,
    name: "Sticky Ginger Pulled Pork",
    initial_g: 500,
    portions: 1.5,
    manufactured_on: "2026-10-14",
    frozen_on: "2026-10-15",
    best_before: "2026-12-01",
  };
  const png = await packageLabel(p, origin, "png");
  const meta = await sharp(png).metadata();
  expect(meta.width).toBe(400);
  expect(meta.height).toBe(240);
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  expect(code?.data).toBe(`${origin}/inventory?id=${id}`);
  const pdf = await PDFDocument.load(await packageLabel(p, origin, "pdf"));
  expect(pdf.getPages()[0].getWidth()).toBeCloseTo((50 / 25.4) * 72);
  expect(pdf.getPages()[0].getHeight()).toBeCloseTo((30 / 25.4) * 72);
});
