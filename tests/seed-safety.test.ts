import { describe, it, expect } from "vitest";
import seed from "../docs/seed-recipes.json";
import plan from "../docs/seed-corrections/storage-reheating-v1.json";
import { importSchema } from "../src/lib/domain";
import {
  canCorrect,
  correctionStatus,
  samePayload,
} from "../src/lib/seed-corrections.mjs";
const recipes = importSchema.parse(seed).payload;
describe("individuálne skladovanie a zohrievanie", () => {
  it.each(recipes.map((r) => [r.name, r] as const))(
    "%s má relevantné pokyny",
    (_, r) => {
      const text = r.storage + " " + r.reheating;
      const rice = r.ingredients.some((i) => /ryž/i.test(i.name));
      if (!rice) expect(text).not.toMatch(/ryž/i);
      if (r.name !== "Zemiaková kaša") expect(text).not.toMatch(/kaš/i);
      expect(text).not.toMatch(/90\s*dní/i);
      if (!r.freezing) expect(r.reheating).toMatch(/studen/i);
    },
  );
  it("ryža vyžaduje rýchle chladenie a jediný ohrev, nie obnovu bezpečnosti teplom", () => {
    for (const r of recipes.filter((r) =>
      r.ingredients.some((i) => /ryž/i.test(i.name)),
    )) {
      expect(r.storage).toMatch(/1 hodiny/);
      expect(r.storage).toMatch(/24 hodín/);
      expect(r.reheating).toMatch(/iba raz/);
    }
    expect(recipes.find((r) => r.name === "Jazmínová ryža")!.storage).toMatch(
      /toxíny/,
    );
  });
  it("surové rezne vyžadujú varenie, hotové samostatný ohrev", () => {
    const r = recipes.find((r) => r.name === "Krkovičkové rezne")!;
    expect(r.storage).toContain("SUROVÉ OBALENÉ");
    expect(r.storage).toContain("HOTOVÉ VYPRÁŽANÉ");
    expect(r.reheating).toMatch(/vypražte alebo prepečte/);
    expect(r.reheating).toMatch(/75 °C počas 30 sekúnd/);
  });
  it("nakladaná cvikla nie je validovaná trvanlivá konzerva", () => {
    expect(recipes.find((r) => r.name === "Nakladaná cvikla")!.storage).toMatch(
      /nemá overené pH/,
    );
  });
  it("každý recept má vlastný obsah a nemenia sa ostatné polia šablón", () => {
    expect(new Set(recipes.map((r) => r.storage)).size).toBe(15);
    expect(new Set(recipes.map((r) => r.reheating)).size).toBe(15);
    for (const item of plan.items) {
      const r = recipes.find((r) => r.name === item.key)!;
      expect(r).toEqual(item.after);
      const before = {
        ...item.before,
        storage: r.storage,
        reheating: r.reheating,
      };
      expect(r).toEqual(before);
    }
  });
});
describe("ochrana používateľských úprav", () => {
  const item = plan.items[0];
  it("povolí iba presnú pôvodnú verziu", () => {
    expect(canCorrect({ ...item.before, version: 1 }, item)).toBe(true);
    expect(canCorrect({ ...item.before, version: 2 }, item)).toBe(false);
    expect(correctionStatus({ ...item.after, version: 2 }, item)).toBe(
      "corrected",
    );
  });
  it.each([
    "name",
    "portions",
    "ingredients",
    "steps",
    "storage",
    "reheating",
    "meat",
    "freezing",
  ])("zmena %s zablokuje automatickú opravu", (field) => {
    const values = {
      name: "Moja úprava",
      portions: 3,
      ingredients: [],
      steps: ["Môj postup"],
      storage: "Moje skladovanie",
      reheating: "Môj ohrev",
      meat: "other",
      freezing: false,
    };
    const row = {
      ...item.before,
      version: 1,
      [field]: values[field as keyof typeof values],
    };
    expect(canCorrect(row, item)).toBe(false);
  });
  it("nevynuluje doplnkové používateľské údaje", () =>
    expect(
      canCorrect(
        { ...item.before, version: 1, description: "Moja poznámka" },
        item,
      ),
    ).toBe(false));
  it("poradie JSON kľúčov neznamená zmenu, poradie krokov áno", () => {
    const row = {
      ...item.before,
      ingredients: item.before.ingredients.map((i) => ({
        unit: i.unit,
        quantity: i.quantity,
        name: i.name,
      })),
    };
    expect(samePayload(row, item.before)).toBe(true);
    expect(
      samePayload({ ...row, steps: [...row.steps].reverse() }, item.before),
    ).toBe(false);
  });
});
