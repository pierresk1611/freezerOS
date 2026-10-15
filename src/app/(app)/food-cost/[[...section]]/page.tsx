import { remainingValue } from "@/lib/domain";
import { readAll } from "@/lib/report-pages";
import { userDb } from "@/lib/supabase";
import {
  minor,
  categories,
  money,
  estimateRecipeCost,
  unitPrice,
  type ReceiptItem,
} from "@/lib/food-cost";
import Link from "next/link";
import Chart from "../charts";
import { revalidatePath } from "next/cache";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
async function budget(form: FormData) {
  "use server";
  const p = z
    .object({
      month: z.string().regex(/^\d{4}-\d{2}-01$/),
      amount: z
        .string()
        .transform(minor)
        .pipe(z.number().int().min(0).max(10000000000)),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/food-cost/budget?error=1");
  const { client, user } = await userDb();
  const r = await client
    .from("purchase_budgets")
    .upsert(
      { user_id: user.id, month: p.data.month, amount_minor: p.data.amount },
      { onConflict: "user_id,month" },
    );
  if (r.error) redirect("/food-cost/budget?error=1");
  revalidatePath("/food-cost");
  redirect(`/food-cost/budget?month=${p.data.month.slice(0, 7)}`);
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{
    month?: string;
    category?: string;
    merchant?: string;
    product?: string;
    error?: string;
  }>;
}) {
  const section = (await params).section?.[0] ?? "";
  if (
    ![
      "",
      "receipts",
      "purchases",
      "items",
      "prices",
      "recipes",
      "budget",
    ].includes(section)
  )
    notFound();
  const q = await searchParams;
  const current = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month ?? "")
    ? q.month!
    : current;
  const { client } = await userDb();
  const [result, stocks, consumed, versions, budgets] = await Promise.all([
    readAll((from, to) =>
      client
        .from("purchase_receipts")
        .select("*,purchase_merchants(name),purchase_receipt_items(*)")
        .order("id")
        .range(from, to),
    ),
    readAll((from, to) =>
      client
        .from("inventory_packages")
        .select("id,remaining_g,initial_g,cost_minor")
        .order("id")
        .range(from, to),
    ),
    readAll((from, to) =>
      client
        .from("meal_logs")
        .select("id,cost_minor,created_at")
        .order("id")
        .range(from, to),
    ),
    readAll((from, to) =>
      client.from("recipe_latest").select("*").order("id").range(from, to),
    ),
    client
      .from("purchase_budgets")
      .select("*")
      .eq("month", month + "-01")
      .maybeSingle(),
  ]);
  if (result.error && !["PGRST205", "42P01"].includes(result.error.code ?? ""))
    return (
      <section className="card">
        <h2>Prehľad nie je dostupný</h2>
        <p>
          Údaje sa nepodarilo načítať. Obnovte stránku; neúplné súčty sa
          nezobrazujú.
        </p>
      </section>
    );
  if (stocks.error || consumed.error || versions.error || budgets.error)
    return (
      <section className="card">
        <h2>Prehľad nie je úplný</h2>
        <p>
          Niektoré dáta sa nepodarilo načítať. Skontrolujte pripojenie a
          aktiváciu migrácie 007.
        </p>
      </section>
    );
  if (result.error)
    return (
      <section className="card">
        <h2>Food Cost čaká na aktiváciu</h2>
        <p>
          V Supabase treba spustiť novú migráciu 007. Existujúce recepty a
          zásoby sú zachované.
        </p>
      </section>
    );
  const all = (result.data ?? []).sort((a, b) =>
    (b.receipt_date ?? b.created_at).localeCompare(
      a.receipt_date ?? a.created_at,
    ),
  );
  const confirmed = all.filter((r) => r.status === "confirmed");
  const filtered = confirmed.filter(
    (r) =>
      r.receipt_date?.startsWith(month) &&
      (!q.merchant || r.purchase_merchants?.name === q.merchant),
  );
  const items = filtered.flatMap((r) =>
    r.purchase_receipt_items
      .filter((i: ReceiptItem) => !q.category || i.category === q.category)
      .map((i: ReceiptItem & { id: string }) => ({
        ...i,
        receipt_id: r.id,
        date: r.receipt_date,
        merchant: r.purchase_merchants?.name ?? "",
      })),
  );
  const total = items.reduce((s, i) => s + Number(i.total_minor), 0);
  const food = items
    .filter((i) => !["equipment", "fees", "alcohol", "drugstore"].includes(i.category))
    .reduce((s, i) => s + Number(i.total_minor), 0);
  const perCategory = Object.keys(categories)
    .map((c) => ({
      name: categories[c as keyof typeof categories],
      value:
        items
          .filter((i) => i.category === c)
          .reduce((s, i) => s + Number(i.total_minor), 0) / 100,
    }))
    .filter((x) => x.value !== 0);
  const aggregate = (rows: { name: string; value: number }[]) =>
    Array.from(
      rows.reduce(
        (m, x) => m.set(x.name, (m.get(x.name) ?? 0) + x.value),
        new Map<string, number>(),
      ),
      ([name, value]) => ({ name, value }),
    ).sort((a, b) => a.name.localeCompare(b.name));
  const history = confirmed.flatMap((r) =>
    r.purchase_receipt_items.map((i: ReceiptItem) => ({
      ...i,
      date: r.receipt_date,
      created_at: r.created_at,
      merchant: r.purchase_merchants?.name ?? "",
    })),
  );
  const previous = new Date(`${month}-15T12:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const prevMonth = previous.toISOString().slice(0, 7);
  const prev = confirmed
    .filter(
      (r) =>
        r.receipt_date.startsWith(prevMonth) &&
        (!q.merchant || r.purchase_merchants?.name === q.merchant),
    )
    .flatMap((r) => r.purchase_receipt_items)
    .filter((i: ReceiptItem) => !q.category || i.category === q.category)
    .reduce((s, i) => s + Number(i.total_minor), 0);
  const unknownStock = (stocks.data ?? []).filter(
    (p) => p.remaining_g > 0 && p.cost_minor === null,
  ).length;
  const inventory = (stocks.data ?? []).reduce(
    (s, p) => s + (p.cost_minor === null ? 0 : remainingValue(p)!),
    0,
  );
  const meals = (consumed.data ?? []).filter(
    (x) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Prague",
        year: "numeric",
        month: "2-digit",
      }).format(new Date(x.created_at)) === month,
  );
  const consumption = meals.reduce((s, x) => s + Number(x.cost_minor ?? 0), 0);
  const monthlyFood = confirmed
    .filter((r) => r.receipt_date.startsWith(month))
    .flatMap((r) => r.purchase_receipt_items)
    .filter((i: ReceiptItem) => !["equipment", "fees", "alcohol", "drugstore"].includes(i.category))
    .reduce((s, i) => s + Number(i.total_minor), 0);
  const budgetPercent =
    budgets.data && Number(budgets.data.amount_minor) > 0
      ? (monthlyFood / Number(budgets.data.amount_minor)) * 100
      : null;
  return (
    <>
      <form className="card food-fields" method="get">
        <label>
          Mesiac a rok
          <input type="month" name="month" defaultValue={month} />
        </label>
        <label>
          Kategória
          <select
            aria-label="Kategória"
            name="category"
            defaultValue={q.category ?? ""}
          >
            <option value="">Všetky kategórie</option>
            {Object.entries(categories).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Obchod
          <select
            aria-label="Obchod"
            name="merchant"
            defaultValue={q.merchant ?? ""}
          >
            <option value="">Všetky obchody</option>
            {Array.from(
              new Set(
                confirmed.map((r) => r.purchase_merchants?.name as string),
              ),
            ).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button>Filtrovať</button>
      </form>
      {section === "" && (
        <>
          <div className="food-kpis">
            {[
              ["Potraviny", money(food)],
              ["Celkové výdavky", money(total)],
              [
                "Počet nákupov",
                String(new Set(items.map((i) => i.receipt_id)).size),
              ],
              [
                "Priemerný nákup",
                items.length
                  ? money(
                      Math.round(
                        total / new Set(items.map((i) => i.receipt_id)).size,
                      ),
                    )
                  : "Bez nákupov",
              ],
              [
                "Oproti minulému mesiacu",
                prev
                  ? `${(((total - prev) / Math.abs(prev)) * 100).toFixed(1)} %`
                  : "Chýba porovnateľný základ",
              ],
            ].map(([n, v]) => (
              <section className="card" key={n}>
                <p>{n}</p>
                <h2>{v}</h2>
              </section>
            ))}
          </div>
          <div className="food-kpis">
            {(
              [
                ["Hovädzie", ["beef"]],
                ["Bravčové", ["pork"]],
                ["Kuracie", ["chicken"]],
                ["Zelenina", ["vegetables"]],
                ["Prílohy", ["grains", "potatoes", "pasta", "legumes"]],
                [
                  "Ostatné potraviny",
                  [
                    "food",
                    "meat",
                    "fruit",
                    "dairy",
                    "eggs",
                    "oil",
                    "sauces",
                    "spices",
                  ],
                ],
              ] as [string, string[]][]
            ).map(([name, keys]) => (
              <section className="card" key={name}>
                <p>{name}</p>
                <strong>
                  {money(
                    items
                      .filter((i) => keys.includes(i.category))
                      .reduce((sum, i) => sum + Number(i.total_minor), 0),
                  )}
                </strong>
              </section>
            ))}
          </div>
          <div className="food-charts">
            <Chart
              title="Mesačné výdavky (vybraný rok)"
              data={aggregate(
                confirmed
                  .filter(
                    (r) =>
                      r.receipt_date.startsWith(month.slice(0, 4)) &&
                      (!q.merchant ||
                        r.purchase_merchants?.name === q.merchant),
                  )
                  .map((r) => ({
                    name: r.receipt_date.slice(0, 7),
                    value:
                      r.purchase_receipt_items
                        .filter(
                          (i: ReceiptItem) =>
                            !q.category || i.category === q.category,
                        )
                        .reduce(
                          (s: number, i: ReceiptItem) =>
                            s + Number(i.total_minor),
                          0,
                        ) / 100,
                  })),
              )}
            />
            <Chart
              title="Denné výdavky"
              data={aggregate(
                items.map((i) => ({
                  name: i.date,
                  value: Number(i.total_minor) / 100,
                })),
              )}
            />
            <Chart title="Výdavky podľa kategórií" data={perCategory} />
            <Chart
              title="Výdavky podľa obchodov"
              data={aggregate(
                items.map((i) => ({
                  name: i.merchant,
                  value: Number(i.total_minor) / 100,
                })),
              )}
            />
            <Chart
              title="Desať najdrahších položiek"
              data={[...items]
                .sort((a, b) => Number(b.total_minor) - Number(a.total_minor))
                .slice(0, 10)
                .map((i) => ({
                  name: i.name,
                  value: Number(i.total_minor) / 100,
                }))}
            />
          </div>
          <section className="card">
            <h2>Nákup ≠ spotreba</h2>
            <p>
              Spotrebované jedlá tento mesiac: {money(consumption)}
              {meals.some((m) => m.cost_minor === null)
                ? " + jedlá s neznámym nákladom"
                : ""}
              .
            </p>
            <p>
              Hodnota zásob so známymi nákladmi: {money(inventory)}
              {unknownStock ? ` + ${unknownStock} balíčkov bez ceny` : ""}.
              Zdroj: existujúce snapshoty várok, nie účtenky.
            </p>
            <p>
              Waste Cost: zatiaľ sa neeviduje vyradenie s nákladom; hodnota je
              neznáma.
            </p>
          </section>
        </>
      )}
      {["receipts", "purchases"].includes(section) && (
        <>
          <h2>
            {section === "receipts"
              ? "Účtenky a pracovné návrhy"
              : "Potvrdené nákupy"}
          </h2>
          <div className="food-kpis">
            {(section === "receipts" ? all : filtered).map((r) => (
              <Link
                className="card"
                key={r.id}
                href={`/food-cost/receipts/${r.id}`}
              >
                <h3>{r.purchase_merchants?.name ?? "Pracovný návrh"}</h3>
                <p>
                  {r.receipt_date ?? "Dátum zatiaľ nezadaný"} ·{" "}
                  {r.total_minor === null
                    ? "Neznáma cena"
                    : money(Number(r.total_minor))}
                </p>
                <p>
                  {
                    (
                      {
                        draft: "Na kontrolu",
                        confirmed: "Potvrdené",
                        cancelled: "Stornované",
                      } as Record<string, string>
                    )[r.status]
                  }{" "}
                  · revízia {r.revision}
                </p>
              </Link>
            ))}
          </div>
          {!all.length && <p>Zatiaľ nemáte žiadne účtenky.</p>}
        </>
      )}
      {section === "items" && (
        <>
          <h2>Analýza položiek</h2>
          <div className="food-kpis">
            {items.map((i) => (
              <article className="card" key={i.id}>
                <h3>{i.name}</h3>
                <p>
                  {categories[i.category as keyof typeof categories]} ·{" "}
                  {i.merchant}
                </p>
                <p>
                  {i.quantity ?? "Neznáme množstvo"} {i.unit} ·{" "}
                  {money(Number(i.total_minor))}
                </p>
                <p>
                  Zľava:{" "}
                  {i.discount_minor === null
                    ? "Neznáma"
                    : money(i.discount_minor)}{" "}
                  (už zahrnutá v cene)
                </p>
                <Link href={`/food-cost/receipts/${i.receipt_id}`}>
                  Otvoriť nákup
                </Link>
              </article>
            ))}
          </div>
        </>
      )}
      {section === "prices" && (
        <>
          <h2>Vývoj zaplatených cien</h2>
          <form method="get">
            <input type="hidden" name="month" value={month} />
            <label>
              Mapovaná surovina alebo produkt
              <select
                aria-label="Mapovaná surovina alebo produkt"
                name="product"
                defaultValue={q.product ?? ""}
              >
                <option value="">Vyberte produkt</option>
                {Array.from(
                  new Set(
                    history.map(
                      (i) => i.ingredient_name || i.product_name || i.name,
                    ),
                  ),
                ).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <button>Zobraziť históriu</button>
          </form>
          {["kg", "l", "ks", "balenie"].map((unit) => {
            const rows = history
              .filter(
                (i) =>
                  (i.ingredient_name || i.product_name || i.name) ===
                    q.product &&
                  (!q.merchant || i.merchant === q.merchant) &&
                  (!q.category || i.category === q.category) &&
                  i.total_minor > 0 &&
                  i.date.startsWith(month.slice(0, 4)),
              )
              .map((i) => ({ i, p: unitPrice(i) }))
              .filter((x) => x.p?.unit === unit);
            return rows.length ? (
              <Chart
                key={unit}
                title={`Zaplatená cena Kč/${unit} po zľavách`}
                line
                data={rows
                  .map(({ i, p }) => ({ name: i.date, value: p!.price / 100 }))
                  .sort((a, b) => a.name.localeCompare(b.name))}
              />
            ) : null;
          })}
          <p>
            Neznáma gramáž nevytvára cenu za kilogram. Balenia rôznych veľkostí
            nemusia byť porovnateľné. Záporné vratky nemenia nákupnú cenu
            suroviny.
          </p>
        </>
      )}
      {section === "recipes" && (
        <>
          <h2>Orientačná kalkulácia receptov</h2>
          <p>
            Zdroj: posledná potvrdená kladná cena používateľsky mapovanej
            suroviny. Nemení náklady historických várok ani hodnotu zásob.
          </p>
          <div className="food-kpis">
            {(versions.data ?? []).map((r) => {
              const {
                subtotal: sum,
                missing,
                unknown,
              } = estimateRecipeCost(r.ingredients, history);
              return (
                <article className="card" key={r.id}>
                  <h3>{r.name}</h3>
                  <p>
                    {unknown
                      ? "Cena receptu je neznáma; suroviny zatiaľ nemajú porovnateľné mapované ceny."
                      : missing
                        ? `Čiastočný náklad: ${money(sum)} · ${missing} surovín bez porovnateľnej ceny`
                        : `Odhad receptu: ${money(sum)}`}
                  </p>
                  <p>
                    {missing
                      ? "Cena porcie nie je úplne známa."
                      : `Odhad porcie: ${money(Math.round(sum / r.portions))}`}
                  </p>
                </article>
              );
            })}
          </div>
        </>
      )}
      {section === "budget" && (
        <section className="card">
          <h2>Mesačný rozpočet na potraviny</h2>
          {budgetPercent !== null && (
            <p
              className={budgetPercent >= 75 ? "food-warning" : "food-success"}
            >
              Čerpanie: {budgetPercent.toFixed(1)} % ·{" "}
              {budgetPercent >= 100
                ? "Rozpočet dosiahnutý alebo prekročený"
                : budgetPercent >= 90
                  ? "Zostáva menej než 10 %"
                  : budgetPercent >= 75
                    ? "Minuté aspoň tri štvrtiny rozpočtu"
                    : "V rámci rozpočtu"}
            </p>
          )}
          {q.error && <p role="alert">Rozpočet sa nepodarilo uložiť.</p>}
          <form action={budget}>
            <input type="hidden" name="month" value={month + "-01"} />
            <label>
              Rozpočet v CZK
              <input
                name="amount"
                type="number"
                min="0"
                max="100000000"
                step=".01"
                defaultValue={
                  budgets.data ? Number(budgets.data.amount_minor) / 100 : ""
                }
                required
              />
            </label>
            <button>Uložiť rozpočet</button>
          </form>
          <p>
            Celkové potravinové výdavky mesiaca bez filtrov:{" "}
            {money(
              confirmed
                .filter((r) => r.receipt_date.startsWith(month))
                .flatMap((r) => r.purchase_receipt_items)
                .filter(
                  (i: ReceiptItem) =>
                    !["equipment", "fees", "alcohol", "drugstore"].includes(i.category),
                )
                .reduce((s, i) => s + Number(i.total_minor), 0),
            )}
          </p>
          {budgets.data && (
            <p>
              Rozpočet: {money(Number(budgets.data.amount_minor))}. Zostatok:{" "}
              {money(
                Number(budgets.data.amount_minor) -
                  confirmed
                    .filter((r) => r.receipt_date.startsWith(month))
                    .flatMap((r) => r.purchase_receipt_items)
                    .filter(
                      (i: ReceiptItem) =>
                        !["equipment", "fees", "alcohol", "drugstore"].includes(i.category),
                    )
                    .reduce((s, i) => s + Number(i.total_minor), 0),
              )}
            </p>
          )}
        </section>
      )}
    </>
  );
}
