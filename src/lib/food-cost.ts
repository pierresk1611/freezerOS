import { z } from "zod";
export const categories = {
  beef: "Hovädzie",
  pork: "Bravčové",
  chicken: "Kuracie",
  meat: "Ostatné mäso",
  vegetables: "Zelenina",
  fruit: "Ovocie",
  legumes: "Kukurica a strukoviny",
  grains: "Ryža a obilniny",
  potatoes: "Zemiaky",
  pasta: "Cestoviny",
  dairy: "Mliečne výrobky",
  eggs: "Vajcia",
  oil: "Oleje",
  sauces: "Omáčky",
  spices: "Koreniny",
  food: "Ostatné potraviny",
  alcohol: "Alkohol",
  drugstore: "Drogéria",
  equipment: "Nepotravinový tovar",
  fees: "Doprava a poplatky",
} as const;
export type Category = keyof typeof categories;
export function normalizeName(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
export function suggestCategory(v: string): Category {
  const n = normalizeName(v);
  for (const [c, re] of Object.entries({
    alcohol: /\b(vino|pivo|vodka|rum|whisky|whiskey|alkohol)\b/,
    drugstore: /praci|praci gel|avivaz|mydlo|sampon|cistic|toalet/,
    beef: /hove|hovad/,
    pork: /vepr|brav|krkov|plec/,
    chicken: /kurac|kure/,
    legumes: /kukur|fazul|fazole|cocka/,
    grains: /ryz|rice|obil/,
    potatoes: /zemiak|bramb/,
    pasta: /cestovin|testovin/,
    vegetables: /mrkv|cibul|cvikl|repa|paprik/,
    fruit: /jablk|banan|pomeranc/,
    dairy: /mliek|mlek|maslo|syr|jogurt/,
    eggs: /vaj|vej/,
    oil: /olej/,
    sauces: /omack|passat/,
    equipment: /sacek|sack|vaku|stitk|tiskarn|forma/,
    fees: /doprav|poplat/,
  }))
    if (re.test(n)) return c as Category;
  return "food";
}
export function minor(v: string): number | null {
  if (!/^-?\d{1,8}([.,]\d{1,2})?$/.test(v.trim())) return null;
  const [a, b = ""] = v.trim().replace(",", ".").replace("-", "").split(".");
  return (
    (v.trim().startsWith("-") ? -1 : 1) *
    (Number(a) * 100 + Number(b.padEnd(2, "0")))
  );
}
export const money = (v: number) =>
  new Intl.NumberFormat("sk-SK", { style: "currency", currency: "CZK" }).format(
    v / 100,
  );
const nullableMoney = z
  .number()
  .int()
  .min(-10000000000)
  .max(10000000000)
  .nullable();
export const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(Object.keys(categories) as [Category, ...Category[]]),
  quantity: z.number().positive().max(1000000).nullable(),
  unit: z.enum(["g", "kg", "ml", "l", "ks", "balenie"]).nullable(),
  unit_price_minor: nullableMoney,
  discount_minor: z.number().int().min(0).max(10000000000).nullable(),
  total_minor: nullableMoney,
  confidence: z.number().min(0).max(1).nullable(),
  product_name: z.string().trim().max(200).nullable(),
  ingredient_name: z.string().trim().max(120).nullable(),
});
export const receiptSchema = z.object({
  merchant: z.string().trim().min(1).max(160),
  date: z.iso.date(),
  order_number: z.string().trim().max(120),
  currency: z.literal("CZK"),
  total_minor: nullableMoney,
  items: z.array(itemSchema).min(1).max(200),
});
export type Receipt = z.infer<typeof receiptSchema>;
export type ReceiptItem = z.infer<typeof itemSchema>;
export const emptyItem = (): ReceiptItem => ({
  name: "",
  category: "food",
  quantity: null,
  unit: null,
  unit_price_minor: null,
  discount_minor: null,
  total_minor: null,
  confidence: null,
  product_name: null,
  ingredient_name: null,
});
export function receiptCheck(r: Receipt) {
  const complete =
    r.total_minor !== null && r.items.every((i) => i.total_minor !== null);
  const sum = r.items.reduce((s, i) => s + (i.total_minor ?? 0), 0);
  return {
    complete,
    sum,
    difference: r.total_minor === null ? null : r.total_minor - sum,
    valid: complete && sum === r.total_minor,
  };
}
export function unitPrice(i: ReceiptItem) {
  if (i.total_minor === null || i.quantity === null || !i.unit) return null;
  const q = i.quantity * (i.unit === "g" || i.unit === "ml" ? 0.001 : 1);
  return {
    price: i.total_minor / q,
    unit: i.unit === "g" ? "kg" : i.unit === "ml" ? "l" : i.unit,
  };
}
export function possibleRepeatedItems(items: ReceiptItem[]) {
  const seen = new Set<string>();
  return items
    .map((i, index) => {
      const k = JSON.stringify([
        normalizeName(i.name),
        i.quantity,
        i.unit,
        i.total_minor,
      ]);
      const repeated = seen.has(k);
      seen.add(k);
      return repeated ? index : -1;
    })
    .filter((i) => i >= 0);
}
export function estimateRecipeCost(
  ingredients: { name: string; quantity: number; unit: string }[],
  history: (ReceiptItem & { date: string; created_at?: string })[],
) {
  let subtotal = 0,
    missing = 0;
  for (const i of ingredients) {
    const rows = history
      .filter(
        (x) =>
          x.ingredient_name &&
          normalizeName(x.ingredient_name) === normalizeName(i.name) &&
          x.total_minor !== null &&
          x.total_minor > 0,
      )
      .map((x) => ({ x, p: unitPrice(x) }))
      .filter(
        (x) =>
          x.p?.unit === (i.unit === "g" ? "kg" : i.unit === "ml" ? "l" : "ks"),
      )
      .sort(
        (a, b) =>
          b.x.date.localeCompare(a.x.date) ||
          (b.x.created_at ?? "").localeCompare(a.x.created_at ?? ""),
      );
    if (!rows.length) missing++;
    else
      subtotal += Math.round(
        (rows[0].p!.price * i.quantity) /
          (i.unit === "g" || i.unit === "ml" ? 1000 : 1),
      );
  }
  return {
    subtotal,
    missing,
    complete: missing === 0,
    unknown: missing === ingredients.length,
  };
}
