import { describe, it, expect } from "vitest";
import seed from "../docs/seed-recipes.json";
import { importSchema, remainingValue } from "../src/lib/domain";
describe("receptové šablóny", () => {
  it("15 validných editovateľných receptov", () => {
    const parsed = importSchema.parse(seed);
    expect(parsed.payload).toHaveLength(15);
    expect(
      parsed.payload.every(
        (r) => r.portions === 2 && r.steps.length > 0 && r.storage.length > 0,
      ),
    ).toBe(true);
  });
  it("majonézový šalát nie je vhodný na mrazenie", () => {
    expect(
      importSchema
        .parse(seed)
        .payload.find((r) => r.name === "Majonézový zemiakový šalát")?.freezing,
    ).toBe(false);
  });
  it("zostatková hodnota zachováva zaokrúhlenie odpisu", () => {
    expect(
      remainingValue({ cost_minor: 101, initial_g: 100, remaining_g: 50 }),
    ).toBe(50);
  });
});
