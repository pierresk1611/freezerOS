import { describe, it, expect, vi, afterEach } from "vitest";
import {
  estimateRecipeCost,
  minor,
  unitPrice,
  receiptCheck,
  emptyItem,
  suggestCategory,
  possibleRepeatedItems,
  receiptSchema,
} from "../src/lib/food-cost";
import { remainingValue } from "../src/lib/domain";
import { receiptProvider } from "../src/lib/receipt-provider";
const data = {
  merchant: "Test obchod",
  date: "2026-10-14",
  order_number: "123",
  currency: "CZK" as const,
  total_minor: 10000,
  items: [
    {
      ...emptyItem(),
      name: "Hovädzia kližka",
      category: "beef" as const,
      quantity: 500,
      unit: "g" as const,
      total_minor: 10000,
      discount_minor: 1000,
    },
  ],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("receipt finance", () => {
  it("parses money exactly in integer haléře", () => {
    expect(minor("213,50")).toBe(21350);
    expect(minor("-20.05")).toBe(-2005);
    expect(minor("0.1")).toBe(10);
    expect(minor("1.234")).toBeNull();
    expect(minor("abc")).toBeNull();
  });
  it("discount not subtracted twice", () => {
    expect(receiptCheck(data).sum).toBe(10000);
    expect(unitPrice(data.items[0])).toEqual({ price: 20000, unit: "kg" });
  });
  it("unknown quantities not converted to invented kg", () => {
    expect(unitPrice({ ...data.items[0], quantity: null })).toBeNull();
    expect(unitPrice({ ...data.items[0], unit: null })).toBeNull();
    expect(
      unitPrice({ ...data.items[0], unit: "balenie", quantity: 2 }),
    ).toEqual({ price: 5000, unit: "balenie" });
  });
  it("null price is incomplete rather than zero", () => {
    expect(
      receiptCheck({
        ...data,
        items: [{ ...data.items[0], total_minor: null }],
      }).valid,
    ).toBe(false);
  });
  it("receipt mismatch fails validation of totals", () => {
    expect(receiptCheck({ ...data, total_minor: 10100 })).toMatchObject({
      valid: false,
      difference: 100,
    });
  });
  it("refund is negative and preserved", () => {
    expect(
      receiptCheck({
        ...data,
        total_minor: -10000,
        items: [{ ...data.items[0], total_minor: -10000 }],
      }).valid,
    ).toBe(true);
  });
  it("food vs equipment and fees suggestions", () => {
    expect(suggestCategory("Hovězí kližka")).toBe("beef");
    expect(suggestCategory("Vákuové sáčky")).toBe("equipment");
    expect(suggestCategory("Doprava")).toBe("fees");
    expect(suggestCategory("Kukurica")).toBe("legumes");
  });
  it("flags overlapping lines without silently deleting legitimate duplicates", () => {
    const i = data.items[0];
    expect(possibleRepeatedItems([i, i])).toEqual([1]);
    expect([i, i]).toHaveLength(2);
  });
  it("strict currency and integer money", () => {
    expect(receiptSchema.safeParse({ ...data, currency: "EUR" }).success).toBe(
      false,
    );
    expect(receiptSchema.safeParse({ ...data, total_minor: 1.5 }).success).toBe(
      false,
    );
  });
  it("provider unavailable without key", () => {
    vi.stubEnv("RECEIPT_OPENAI_API_KEY", "");
    expect(receiptProvider()).toBeNull();
  });
  it("provider contract extracts structured image and multipage PDF without confirming", async () => {
    vi.stubEnv("RECEIPT_OPENAI_API_KEY", "test-only-not-a-real-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          { content: [{ type: "output_text", text: JSON.stringify(data) }] },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await receiptProvider()!.extract([
      { mime: "image/png", bytes: new Uint8Array([1]), filename: "test.png" },
      {
        mime: "application/pdf",
        bytes: new Uint8Array([2]),
        filename: "test.pdf",
      },
    ]);
    expect(r.total_minor).toBe(10000);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.input[0].content[1].type).toBe("input_image");
    expect(body.input[0].content[2].type).toBe("input_file");
  });
  it("provider failure surfaces manual fallback", async () => {
    vi.stubEnv("RECEIPT_OPENAI_API_KEY", "test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(receiptProvider()!.extract([])).rejects.toThrow("ručne");
  });
  it("provider partial values preserved", async () => {
    vi.stubEnv("RECEIPT_OPENAI_API_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    ...data,
                    merchant: null,
                    date: null,
                    total_minor: null,
                    items: [
                      { ...data.items[0], quantity: null, total_minor: null },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
      }),
    );
    const r = await receiptProvider()!.extract([]);
    expect(r.items[0].total_minor).toBeNull();
    expect(r.date).toBeNull();
  });
  it("rejects hallucinated invalid provider shape", async () => {
    vi.stubEnv("RECEIPT_OPENAI_API_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output: [
            {
              content: [{ type: "output_text", text: '{"items":"invented"}' }],
            },
          ],
        }),
      }),
    );
    await expect(receiptProvider()!.extract([])).rejects.toThrow();
  });
});

it("remaining stock uses original ledger rounding, preserving haléř balance", () => {
  expect(remainingValue({ cost_minor: 1, initial_g: 2, remaining_g: 1 })).toBe(
    0,
  );
  expect(
    remainingValue({ cost_minor: null, initial_g: 2, remaining_g: 1 }),
  ).toBeNull();
});

it("foreign currency is not silently relabeled CZK", async () => {
  vi.stubEnv("RECEIPT_OPENAI_API_KEY", "test");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ ...data, currency: "EUR" }),
              },
            ],
          },
        ],
      }),
    }),
  );
  await expect(receiptProvider()!.extract([])).rejects.toThrow("CZK");
});

it("unknown informational discount remains null without blocking known paid total", () => {
  const r = { ...data, items: [{ ...data.items[0], discount_minor: null }] };
  expect(receiptSchema.safeParse(r).success).toBe(true);
  expect(receiptCheck(r).valid).toBe(true);
});

it("recipe estimate uses only matching units and confirmed mapped prices", () => {
  const ingredient = { name: "Hovädzia kližka", quantity: 700, unit: "g" };
  const row = {
    ...data.items[0],
    ingredient_name: ingredient.name,
    date: "2026-10-14",
  };
  expect(estimateRecipeCost([ingredient], [row])).toMatchObject({
    subtotal: 14000,
    complete: true,
  });
  expect(
    estimateRecipeCost(
      [ingredient, { name: "Mrkva", quantity: 100, unit: "g" }],
      [row],
    ),
  ).toMatchObject({ subtotal: 14000, missing: 1, complete: false });
  expect(
    estimateRecipeCost([ingredient], [{ ...row, unit: "ml" }]),
  ).toMatchObject({ unknown: true, complete: false });
  expect(
    estimateRecipeCost([ingredient], [{ ...row, total_minor: -100 }]),
  ).toMatchObject({ unknown: true });
});

it("alcohol and drugstore suggestions do not mistake rumsteak or vinegar", () => {
  expect(suggestCategory("Červené víno")).toBe("alcohol");
  expect(suggestCategory("Prací gél")).toBe("drugstore");
  expect(suggestCategory("Hovězí rumsteak")).toBe("beef");
  expect(suggestCategory("Jablčný ocot")).not.toBe("alcohol");
});
