import { it, expect } from "vitest";
import { parseCzk } from "../src/lib/domain";
it("presné sumy v CZK bez floating-point konverzie", () => {
  expect(parseCzk("278.01")).toBe(27801);
  expect(parseCzk("0,99")).toBe(99);
  expect(parseCzk("12")).toBe(1200);
  expect(parseCzk("12.3")).toBe(1230);
  expect(parseCzk("")).toBeNull();
  expect(() => parseCzk("1e9")).toThrow();
  expect(() => parseCzk("999999999999999999999999")).toThrow();
  expect(() => parseCzk("-1")).toThrow();
});
