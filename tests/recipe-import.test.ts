import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  contentKey,
  normalizedText,
  normalizeFiles,
  previewRows,
  stable,
  importError,
} from "../src/lib/recipe-import";
const recipe = {
  name: "Recept",
  portions: 2,
  ingredients: [{ name: "Mäso", quantity: 500, unit: "g" }],
  steps: ["Dusiť mäso."],
  reheating: "Dôkladne ohriať.",
  storage: "Rýchlo schladiť.",
  meat: "beef",
  freezing: true,
};
const file = (payload: unknown[], id: string = randomUUID()) => ({
  name: "test.json",
  data: {
    schemaVersion: "1.0",
    importType: "recipes",
    importId: id,
    generatedAt: "2026-10-15T08:00:00Z",
    source: "test",
    payload,
  },
});
describe("hromadný import", () => {
  it("stable JSON ignores key order without losing array order", () => {
    expect(stable({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(stable([2, 1])).not.toBe(stable([1, 2]));
  });
  it("preview contains all twelve valid recipes", () => {
    const files = normalizeFiles([
      file(
        Array.from({ length: 12 }, (_, n) => ({
          ...recipe,
          name: `Recept ${n}`,
          ingredients: [{ name: "Mäso", quantity: 500 + n, unit: "g" }],
        })),
      ),
    ]);
    expect(previewRows(files, [], new Set(), new Set())).toHaveLength(12);
  });
  it("normalizes accents, spaces, reordered ingredients and recipe metadata", () => {
    expect(normalizedText("  HOVÄDZIE  mäso ")).toBe("hovadzie maso");
    const a = {
      ...recipe,
      ingredients: [
        ...recipe.ingredients,
        { name: "Cibuľa", quantity: 100, unit: "g" },
      ],
    };
    expect(contentKey(a)).toBe(
      contentKey({
        ...a,
        name: "Iný názov",
        ingredients: [...a.ingredients].reverse(),
        metadata: { category: "general" },
      }),
    );
  });
  it("marks duplicate name independently of changed content", () => {
    const files = normalizeFiles([file([recipe])]);
    const row = previewRows(
      files,
      [
        {
          id: randomUUID(),
          recipe_id: randomUUID(),
          version: 2,
          name: "RÉCEPT",
          content: contentKey({ ...recipe, portions: 3 }),
          archived: false,
        },
      ],
      new Set(),
      new Set(),
    )[0];
    expect(row.duplicates).toHaveLength(1);
  });
  it("marks renamed identical content and within-file duplicates", () => {
    const files = normalizeFiles([
      file([recipe, { ...recipe, name: "Premenované" }]),
    ]);
    expect(previewRows(files, [], new Set(), new Set())[1].within).toBe(true);
  });
  it("different importId files keep separate indices", () => {
    const f = normalizeFiles([
      file([recipe]),
      file([{ ...recipe, portions: 3 }]),
    ]);
    expect(previewRows(f, [], new Set(), new Set()).map((r) => r.key)).toEqual([
      "0:0",
      "1:0",
    ]);
  });
  it("same importId with altered content is a conflict", () => {
    const id = randomUUID(),
      f = normalizeFiles([
        file([recipe], id),
        file([{ ...recipe, portions: 3 }], id),
      ]);
    expect(
      previewRows(f, [], new Set(), new Set()).every((r) => r.conflict),
    ).toBe(true);
  });
  it("invalid item does not hide valid neighbours", () => {
    const f = normalizeFiles([file([recipe, { name: "Invalid" }, recipe])]);
    const r = previewRows(f, [], new Set(), new Set());
    expect(r).toHaveLength(3);
    expect(r[1].error).toContain("portions");
    expect(r[0].error).toBeUndefined();
  });
  it("recognizes prior legacy whole-file imports and processed item indices", () => {
    const f = normalizeFiles([file([recipe])]);
    expect(
      previewRows(f, [], new Set(), new Set([f[0].data.importId]))[0].already,
    ).toBe(true);
    expect(
      previewRows(f, [], new Set([f[0].data.importId + ":0"]), new Set())[0]
        .already,
    ).toBe(true);
  });
  it("schema 1.0 and limits remain enforced", () => {
    expect(() =>
      normalizeFiles([file([recipe]), ...Array(10).fill(file([recipe]))]),
    ).toThrow();
    expect(() =>
      normalizeFiles([
        {
          ...file([recipe]),
          data: { ...file([recipe]).data, schemaVersion: "2.0" },
        },
      ]),
    ).toThrow();
  });
  it("returns a real activation or conflict reason", () => {
    expect(importError({ code: "PGRST202", message: "missing" })).toContain(
      "008",
    );
    expect(importError({ message: "SOURCE_CHANGED" })).toContain(
      "inému obsahu",
    );
  });
});

it("UUID capitalization cannot bypass source identity", () => {
  const id = randomUUID();
  const f = normalizeFiles([
    file([recipe], id.toUpperCase()),
    file([{ ...recipe, portions: 3 }], id),
  ]);
  expect(f[0].data.importId).toBe(id);
  expect(
    previewRows(f, [], new Set(), new Set()).every((r) => r.conflict),
  ).toBe(true);
});
