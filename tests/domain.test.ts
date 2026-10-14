import { describe, it, expect } from "vitest";
import {
  nutrition,
  portionCost,
  importSchema,
  recommend,
} from "../src/lib/domain";
describe("doména", () => {
  it("neznáma výživa nie je nula", () => {
    expect(nutrition([{ grams: 50, kcalPer100g: null }])).toBeNull();
    expect(nutrition([])).toBeNull();
  });
  it("počíta známu výživu", () =>
    expect(nutrition([{ grams: 250, kcalPer100g: 120 }])).toBe(300));
  it("cena v halieroch", () => {
    expect(portionCost(27800, 2)).toBe(13900);
    expect(portionCost(null, 2)).toBeNull();
    expect(() => portionCost(100, 0)).toThrow();
  });
  it("odmieta neplatný import", () =>
    expect(importSchema.safeParse({ importType: "recipes" }).success).toBe(
      false,
    ));
  it("nevie odporučiť prázdny sklad", () =>
    expect(recommend([], [])).toBeNull());
  it("neodporučí spotrebovaný balíček", () =>
    expect(
      recommend(
        [
          {
            id: "1",
            name: "Guláš",
            remaining_g: 0,
            initial_g: 500,
            cost_minor: null,
            best_before: null,
            created_at: "",
            location_id: null,
          },
        ],
        [],
      ),
    ).toBeNull());
});
