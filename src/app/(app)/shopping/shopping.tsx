"use client";
import { shoppingFromMeals } from "@/lib/culinary-planning";
import type { PlannedBatch } from "@/lib/planning";
import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { normalizeName } from "@/lib/food-cost";
import {
  pragueToday,
  shoppingRequirements,
  reconcileShopping,
  shoppingText,
  shoppingCsv,
  rohlikShoppingTask,
  packagesNeeded,
  type ShoppingPlan,
  type PlanningRecipe,
  type Pantry,
  type Meal,
} from "@/lib/planning";
const statusLabels = {
  draft: "Rozpracovaný",
  ready: "Pripravený",
  exported: "Exportovaný",
  partially_purchased: "Čiastočne nakúpený",
  purchased: "Nakúpený",
  closed: "Uzavretý",
  cancelled: "Zrušený",
};
export default function Shopping({
  recipes,
  latest,
  available,
  initialPlans,
  pantry,
  receipts,
  weekEntries,
  batches,
  mealEntries,
  aliases,
}: {
  mealEntries: Meal[];
  aliases: Record<string, string>;
  recipes: PlanningRecipe[];
  latest: PlanningRecipe[];
  available: Record<string, number | null>;
  initialPlans: ShoppingPlan[];
  pantry: Pantry[];
  receipts: {
    id: string;
    total_minor: number;
    receipt_date: string;
    purchase_receipt_items: {
      id: string;
      name: string;
      ingredient_name: string | null;
      quantity: number | null;
      unit: string | null;
      category: string;
      total_minor: number;
    }[];
  }[];
  weekEntries: Meal[];
  batches: PlannedBatch[];
}) {
  const router = useRouter();
  const [plan, storePlan] = useState<ShoppingPlan | null>(null),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [diff, setDiff] = useState<{
      plan: ShoppingPlan;
      conflicts: string[];
    } | null>(null),
    [replacement, setReplacement] = useState<{
      index: number;
      version: string;
    } | null>(null),
    [pantryEdit, setPantryEdit] = useState<Pantry | null>(null),
    [needsCalculation, setNeedsCalculation] = useState(false),
    [syncCalendar, setSyncCalendar] = useState(false),
    [receiptPantry, setReceiptPantry] = useState(""),
    [receiptItems, setReceiptItems] = useState<string[]>([]);
  function setPlan(value: ShoppingPlan | null) {
    storePlan(value);
    setDirty(true);
    setMessage("");
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const plannedEstimate = plan?.recipes.reduce(
    (s, c) => {
      const r = recipes.find((r) => r.id === c.recipe_version_id);
      return s === null || r?.estimated_cost_minor === undefined
        ? null
        : s +
            Math.round(
              (r.estimated_cost_minor * (c.portions - c.from_freezer)) /
                r.portions,
            );
    },
    0 as number | null,
  );
  const locked = plan && !["draft", "ready"].includes(plan.status);
  async function persist(action: string, data: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/planning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: crypto.randomUUID(), action, data }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      router.refresh();
      setMessage(
        result.result?.imported !== undefined
          ? result.result.already
            ? "Táto účtenka už bola prevzatá do špajze; nový príjem nevznikol."
            : `Do špajze prijatých ${result.result.imported} položiek.`
          : "Uložené.",
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(p: ShoppingPlan) {
    if (
      await persist("shopping", {
        ...p,
        recipes: [...p.recipes].sort((a, b) => a.id.localeCompare(b.id)),
      })
    ) {
      setPlan({
        ...p,
        calendar_changes: undefined,
        revision: p.revision === undefined ? 0 : p.revision + 1,
      });
      setDirty(false);
      setMessage("Uložené.");
    }
  }
  function newPlan(fromWeek = false) {
    setNeedsCalculation(fromWeek);
    setPlan({
      id: crypto.randomUUID(),
      name: fromWeek ? "Nákup z jedálnička" : "Meal prep nákup",
      status: "draft",
      recipes: fromWeek
        ? shoppingFromMeals(weekEntries, batches, () => crypto.randomUUID())
        : [],
      items: [],
    });
    setDiff(null);
  }
  function calculate(p: ShoppingPlan) {
    try {
      const req = shoppingRequirements(
        p.recipes,
        recipes,
        pantry,
        pragueToday(),
        aliases,
      );
      const next = reconcileShopping(req, p.items, () => crypto.randomUUID());
      setDiff({ plan: { ...p, items: next.items }, conflicts: next.conflicts });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function download(csv: boolean) {
    if (!plan) return;
    const url = URL.createObjectURL(
      new Blob([csv ? shoppingCsv(plan) : shoppingText(plan)], {
        type: csv ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = csv ? "freezer-nakup.csv" : "freezer-nakup.txt";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="recipe-page">
      <header>
        <p className="eyebrow">Od plánu k nákupu</p>
        {initialPlans.some((p) => p.planner_review_required) && (
          <p role="status" className="card">
            Jedálniček sa zmenil. Existujúce nákupy a potvrdené doklady zostali
            zachované. Pred ďalším nákupom vytvorte nový návrh z týždňa a
            porovnajte ho s pôvodným; pri odoslaných plánoch vytvorte doplnkový
            nákup.
          </p>
        )}
        <h1>Nákupy a špajza</h1>
        <p>
          Požiadavky z receptov, skutočné domáce suroviny a potvrdené nákupy
          zostávajú oddelené.
        </p>
      </header>
      <Link href="/meal-plan">← Jedálniček</Link>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="planning-toolbar">
        <button onClick={() => newPlan()}>Nový meal prep nákup</button>
        {weekEntries.length > 0 && (
          <button onClick={() => newPlan(true)}>
            Nákup z týždňa ({weekEntries.length} jedál)
          </button>
        )}
      </div>
      <div className="shopping-layout">
        <aside className="card">
          <h2>Vaše plány</h2>
          {initialPlans.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setPlan(structuredClone(p));
                setDirty(false);
                setNeedsCalculation(false);
                setDiff(null);
              }}
            >
              {p.name} · {statusLabels[p.status]}
            </button>
          ))}
          {!initialPlans.length && <p>Zatiaľ nemáte uložený nákupný plán.</p>}
          <h2>Rohlík nie je pripojený</h2>
          <p>
            Priame pripojenie vlastného klienta zatiaľ nie je overené. Žiadny
            košík nemeníme.
          </p>
          <a href="https://www.rohlik.cz" target="_blank" rel="noreferrer">
            Otvoriť Rohlík
          </a>
          <p>
            <a
              href="https://chatgpt.com/apps/rohl-k/asdk_app_6a03211155c08191a2bc0e895ee55ff2"
              target="_blank"
              rel="noreferrer"
            >
              Oficiálna aplikácia Rohlík v ChatGPT
            </a>
          </p>
        </aside>
        {plan ? (
          <section className="card">
            <label>
              Názov plánu
              <input
                value={plan.name}
                disabled={!!locked}
                onChange={(e) => setPlan({ ...plan, name: e.target.value })}
              />
            </label>
            <p>
              Stav: {statusLabels[plan.status]} · revízia{" "}
              {plan.revision ?? "nový"}
            </p>
            {locked && (
              <>
                <p>
                  Odoslaný alebo nakúpený plán má zamknuté položky. Vytvorte
                  doplnkový nákup.
                </p>
                <button
                  onClick={() => {
                    newPlan();
                  }}
                >
                  Vytvoriť doplnkový nákup
                </button>
              </>
            )}
            {dirty && (
              <p className="planning-dirty">
                Neuložené zmeny nákupného plánu. Potvrďte prepočet a kliknite na
                Uložiť nákupný plán.
              </p>
            )}
            <h2>Čo budete variť?</h2>
            {plan.recipes.map((c, index) => {
              const r = recipes.find((r) => r.id === c.recipe_version_id);
              const stock = available[r?.recipe_id ?? ""];
              return (
                <article className="shopping-recipe" key={c.id}>
                  {r?.photo && (
                    <Image
                      src={r.photo}
                      alt=""
                      width={500}
                      height={300}
                      unoptimized
                    />
                  )}
                  <h3>
                    <Link href={"/meal-plan/recipe/" + c.recipe_version_id}>
                      {r?.name}
                    </Link>
                  </h3>
                  <label>
                    Počet porcií
                    <input
                      type="number"
                      min=".01"
                      step=".01"
                      max="100"
                      value={c.portions}
                      disabled={!!locked}
                      onChange={(e) => {
                        setNeedsCalculation(true);
                        setPlan({
                          ...plan,
                          recipes: plan.recipes.map((x, i) =>
                            i === index
                              ? {
                                  ...x,
                                  portions: Number(e.target.value),
                                  from_freezer: Math.min(
                                    x.from_freezer,
                                    Number(e.target.value),
                                  ),
                                }
                              : x,
                          ),
                        });
                      }}
                    />
                  </label>
                  <p>
                    {stock === undefined
                      ? "Hotové jedlo neevidujeme."
                      : stock === null
                        ? "Hotové jedlo evidujeme v gramoch. Počet porcií nie je známy."
                        : `Mraznička: ${stock.toFixed(2)} evidovaných porcií. Bez rezervácie.`}
                  </p>
                  {typeof stock === "number" && (
                    <label>
                      Z toho použiť hotové porcie (neodpisuje sklad)
                      <input
                        type="number"
                        min="0"
                        step=".01"
                        max={Math.min(stock, c.portions)}
                        value={c.from_freezer}
                        disabled={!!locked}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          const other = plan.recipes
                            .filter(
                              (x) =>
                                x.id !== c.id &&
                                recipes.find(
                                  (r) => r.id === x.recipe_version_id,
                                )?.recipe_id === r?.recipe_id,
                            )
                            .reduce((s, x) => s + x.from_freezer, 0);
                          if (n + other > stock) {
                            setError(
                              "Rovnaké hotové porcie už používa iný riadok tohto plánu.",
                            );
                            return;
                          }
                          setNeedsCalculation(true);
                          setPlan({
                            ...plan,
                            recipes: plan.recipes.map((x, i) =>
                              i === index ? { ...x, from_freezer: n } : x,
                            ),
                          });
                        }}
                      />
                    </label>
                  )}
                  <div className="planning-toolbar">
                    <button
                      disabled={!!locked}
                      onClick={() =>
                        setReplacement({ index, version: c.recipe_version_id })
                      }
                    >
                      Vymeniť recept
                    </button>
                    <button
                      disabled={!!locked}
                      onClick={() =>
                        calculate({
                          ...plan,
                          recipes: plan.recipes.filter((x) => x.id !== c.id),
                        })
                      }
                    >
                      Odobrať recept
                    </button>
                  </div>
                  {c.meal_entry_id && (
                    <p>
                      Zdroj: týždenný plán. Synchronizáciu výmeny možno potvrdiť
                      v náhľade prepočtu.{" "}
                      <Link href="/meal-plan">Upraviť aj jedálniček</Link>
                    </p>
                  )}
                </article>
              );
            })}
            {!locked && (
              <label>
                Pridať recept
                <select
                  aria-label="Pridať recept"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      setNeedsCalculation(true);
                      setPlan({
                        ...plan,
                        recipes: [
                          ...plan.recipes,
                          {
                            id: crypto.randomUUID(),
                            recipe_version_id: e.target.value,
                            portions: recipes.find(
                              (r) => r.id === e.target.value,
                            )!.portions,
                            from_freezer: 0,
                            meal_entry_id: null,
                          },
                        ],
                      });
                    }
                  }}
                >
                  <option value="">Vyberte recept…</option>
                  {latest.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button disabled={!!locked || busy} onClick={() => calculate(plan)}>
              Prepočítať ingrediencie – náhľad
            </button>
            <h2>Nákupný zoznam</h2>
            {plan.items.map((i, index) => (
              <div className="shopping-line" key={i.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={i.checked}
                    disabled={!!locked}
                    onChange={(e) =>
                      setPlan({
                        ...plan,
                        items: plan.items.map((x, k) =>
                          k === index ? { ...x, checked: e.target.checked } : x,
                        ),
                      })
                    }
                  />
                  {i.name}
                  {i.manual ? " · manuálne" : ""}
                </label>
                <label>
                  Kúpiť ({i.unit})
                  <input
                    type="number"
                    min="0"
                    step=".0001"
                    value={i.quantity}
                    disabled={!!locked}
                    onChange={(e) =>
                      setPlan({
                        ...plan,
                        items: plan.items.map((x, k) =>
                          k === index
                            ? {
                                ...x,
                                quantity: Number(e.target.value),
                                selection: {
                                  ...x.selection,
                                  quantity_override: true,
                                },
                              }
                            : x,
                        ),
                      })
                    }
                  />
                </label>
                <p>
                  Recepty potrebujú {i.required} {i.unit}. Zdroje:{" "}
                  {i.origins
                    .map(
                      (o) =>
                        recipes.find((r) => r.id === o.recipe_version_id)?.name,
                    )
                    .join(", ") || "manuálny nákup"}
                </p>
                {!locked && (
                  <details>
                    <summary>Nákupné balenie</summary>
                    <label>
                      Obsah jedného balenia ({i.unit})
                      <input
                        type="number"
                        min=".0001"
                        step=".0001"
                        value={Number(i.selection?.pack_quantity ?? 0) || ""}
                        onChange={(e) =>
                          setPlan({
                            ...plan,
                            items: plan.items.map((x, k) =>
                              k === index
                                ? {
                                    ...x,
                                    selection: {
                                      ...x.selection,
                                      pack_quantity: Number(e.target.value),
                                    },
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Minimálny počet balení
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={Number(i.selection?.minimum_pack_count ?? 1)}
                        onChange={(e) =>
                          setPlan({
                            ...plan,
                            items: plan.items.map((x, k) =>
                              k === index
                                ? {
                                    ...x,
                                    selection: {
                                      ...x.selection,
                                      minimum_pack_count: Number(
                                        e.target.value,
                                      ),
                                    },
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      onClick={() => {
                        const size = Number(i.selection?.pack_quantity);
                        if (
                          !Number.isFinite(size) ||
                          size <= 0 ||
                          !Number.isInteger(
                            Number(i.selection?.minimum_pack_count ?? 1),
                          ) ||
                          Number(i.selection?.minimum_pack_count ?? 1) < 1
                        ) {
                          setError(
                            "Zadajte skutočné množstvo na balenie v rovnakej jednotke.",
                          );
                          return;
                        }
                        const needed = i.manual
                          ? i.quantity
                          : (shoppingRequirements(
                              plan.recipes,
                              recipes,
                              pantry,
                              pragueToday(),
                              aliases,
                            ).find(
                              (r) =>
                                r.ingredient_key === i.ingredient_key &&
                                r.unit === i.unit,
                            )?.quantity ?? 0);
                        const selected = packagesNeeded(
                          needed,
                          size,
                          Number(i.selection?.minimum_pack_count ?? 1),
                        );
                        setPlan({
                          ...plan,
                          items: plan.items.map((x, k) =>
                            k === index
                              ? {
                                  ...x,
                                  quantity: selected.count * size,
                                  selection: {
                                    ...x.selection,
                                    pack_count: selected.count,
                                    quantity_override: true,
                                  },
                                }
                              : x,
                          ),
                        });
                        setMessage(
                          `${i.name}: ${selected.count} balení, prebytok ${selected.excess} ${i.unit}.`,
                        );
                      }}
                    >
                      Potvrdiť počet balení
                    </button>
                  </details>
                )}
              </div>
            ))}
            {!locked && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget),
                    name = String(f.get("name")).trim();
                  if (!name) return;
                  setPlan({
                    ...plan,
                    items: [
                      ...plan.items,
                      {
                        id: crypto.randomUUID(),
                        name,
                        ingredient_key: normalizeName(name),
                        unit: f.get("unit") as "ks" | "g" | "ml",
                        quantity: Number(f.get("quantity")),
                        required: 0,
                        manual: true,
                        checked: false,
                        origins: [],
                        selection: null,
                      },
                    ],
                  });
                  e.currentTarget.reset();
                }}
              >
                <h3>Manuálna položka</h3>
                <label>
                  Názov
                  <input name="name" required maxLength={160} />
                </label>
                <label>
                  Množstvo
                  <input
                    name="quantity"
                    type="number"
                    min=".01"
                    step=".01"
                    defaultValue={1}
                    required
                  />
                </label>
                <label>
                  Jednotka
                  <select aria-label="Jednotka" name="unit">
                    <option>ks</option>
                    <option>g</option>
                    <option>ml</option>
                  </select>
                </label>
                <button>Pridať manuálnu položku</button>
              </form>
            )}
            <p>
              {plannedEstimate === null || plannedEstimate === undefined
                ? "Orientačný náklad receptov je neúplný alebo neznámy."
                : `Orientačný náklad receptových surovín podľa historických cien: ${(plannedEstimate / 100).toFixed(2)} Kč. Nezahŕňa manuálne položky, balenia ani aktuálne zľavy.`}{" "}
              Skutočne zaplatené sumy nájdete na prepojenej potvrdenej účtenke
              vo Food Cost.
            </p>
            <label>
              Stav
              <select
                aria-label="Stav"
                value={plan.status}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    status: e.target.value as ShoppingPlan["status"],
                  })
                }
              >
                {Object.entries(statusLabels).map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prepojiť skutočnú potvrdenú účtenku
              <select
                aria-label="Prepojiť skutočnú potvrdenú účtenku"
                value={plan.receipt_id ?? ""}
                onChange={(e) =>
                  setPlan({ ...plan, receipt_id: e.target.value || null })
                }
              >
                <option value="">Bez novej väzby</option>
                {receipts.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.receipt_date} · {(r.total_minor / 100).toFixed(2)} Kč ·{" "}
                    {r.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <div className="planning-toolbar">
              {needsCalculation && (
                <p role="alert">
                  Zmenili sa plánované porcie alebo recepty. Pred uložením
                  potvrďte prepočet ingrediencií.
                </p>
              )}
              <button
                disabled={busy || needsCalculation}
                onClick={() => save(plan)}
              >
                Uložiť nákupný plán
              </button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shoppingText(plan));
                    setMessage("Zoznam skopírovaný.");
                  } catch {
                    setError(
                      "Schránka nie je dostupná. Použite textový export.",
                    );
                  }
                }}
              >
                Kopírovať zoznam
              </button>
              <button onClick={() => download(false)}>Textový export</button>
              <button onClick={() => download(true)}>CSV export</button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      JSON.stringify(rohlikShoppingTask(plan), null, 2),
                    );
                    setMessage("Zadanie pre Rohlík skopírované.");
                  } catch {
                    setError("Schránka nie je dostupná.");
                  }
                }}
              >
                Pripraviť zadanie pre Rohlík
              </button>
              <button
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob(
                      [JSON.stringify(rohlikShoppingTask(plan), null, 2)],
                      { type: "application/json" },
                    ),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "freezer-rohlik-zadanie.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                JSON zadanie pre ChatGPT
              </button>
            </div>
          </section>
        ) : (
          <section className="card">
            <h2>Najskôr vyberte plán</h2>
            <p>
              Začnite výberom receptov alebo jedálničkom. Nákup nie je
              konzumácia.
            </p>
          </section>
        )}
      </div>
      <section className="card">
        <h2>Potvrdené názvy surovín</h2>
        <p>Alias spája iba názvy, nikdy neprevádza jednotky.</p>
        {Object.entries(aliases).map(([a, c]) => (
          <p key={a}>
            {a} → {c}
          </p>
        ))}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await persist("alias", {
              alias: normalizeName(String(f.get("alias"))),
              canonical: normalizeName(String(f.get("canonical"))),
            });
          }}
        >
          <label>
            Alternatívny názov
            <input name="alias" required maxLength={160} />
          </label>
          <label>
            Spoločný názov
            <input name="canonical" required maxLength={160} />
          </label>
          <button disabled={busy}>Potvrdiť mapovanie</button>
        </form>
      </section>{" "}
      <section className="card">
        <h2>Prevziať skutočný nákup do špajze</h2>
        <p>
          Potvrďte iba suroviny, ktoré ste fyzicky prevzali a ešte máte doma.
          Účtenka sa prevezme najviac raz; nevybrané alebo neurčité položky
          môžete pridať ručne. Neskoršia oprava účtenky tento príjem neopakuje.
        </p>
        <label>
          Potvrdená účtenka
          <select
            aria-label="Potvrdená účtenka"
            value={receiptPantry}
            onChange={(e) => {
              setReceiptPantry(e.target.value);
              setReceiptItems([]);
            }}
          >
            <option value="">Vyberte účtenku…</option>
            {receipts.map((r) => (
              <option key={r.id} value={r.id}>
                {r.receipt_date} · {(r.total_minor / 100).toFixed(2)} Kč ·{" "}
                {r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        {receipts
          .find((r) => r.id === receiptPantry)
          ?.purchase_receipt_items.filter(
            (i) =>
              i.ingredient_name &&
              i.quantity !== null &&
              i.quantity > 0 &&
              i.unit &&
              ["g", "kg", "ml", "l", "ks"].includes(i.unit) &&
              i.total_minor >= 0 &&
              !["equipment", "fees", "alcohol", "drugstore"].includes(
                i.category,
              ),
          )
          .map((i) => (
            <label className="shopping-line" key={i.id}>
              <input
                type="checkbox"
                checked={receiptItems.includes(i.id)}
                onChange={(e) =>
                  setReceiptItems(
                    e.target.checked
                      ? [...receiptItems, i.id]
                      : receiptItems.filter((id) => id !== i.id),
                  )
                }
              />
              {i.ingredient_name} · {i.quantity} {i.unit}
            </label>
          ))}
        <p>
          Ak surovina chýba v ponuke, vo Food Cost musí mať potvrdené mapovanie
          a známe množstvo v porovnateľnej jednotke.
        </p>
        <button
          disabled={busy || !receiptItems.length}
          onClick={() =>
            persist("receive", { receipt: receiptPantry, items: receiptItems })
          }
        >
          Potvrdiť fyzické prevzatie do špajze
        </button>
      </section>
      <section className="card">
        <h2>Špajza / domáce suroviny</h2>
        <p>
          História účteniek sama nevytvára dostupné suroviny. Evidujte iba to,
          čo skutočne máte doma.
        </p>
        {pantry.map((p) => (
          <button key={p.id} onClick={() => setPantryEdit({ ...p })}>
            {p.name} · {p.quantity} {p.unit}
            {p.expires_on ? ` · do ${p.expires_on}` : ""}
          </button>
        ))}
        <button
          onClick={() =>
            setPantryEdit({
              id: crypto.randomUUID(),
              revision: undefined,
              name: "",
              ingredient_key: "",
              quantity: 1,
              unit: "g",
              expires_on: null,
              purchased_on: null,
              location: "",
              cost_minor: null,
            })
          }
        >
          Pridať domácu surovinu
        </button>
      </section>
      {pantryEdit && (
        <div className="planning-overlay">
          <form
            className="planning-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Domáca surovina"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await persist("pantry", {
                  ...pantryEdit,
                  ingredient_key: normalizeName(pantryEdit.name),
                  purchased_on: pantryEdit.purchased_on ?? null,
                  cost_minor: pantryEdit.cost_minor ?? null,
                  location: pantryEdit.location ?? "",
                })
              )
                setPantryEdit(null);
            }}
          >
            <h2>Domáca surovina</h2>
            <label>
              Názov
              <input
                value={pantryEdit.name}
                required
                maxLength={120}
                onChange={(e) =>
                  setPantryEdit({ ...pantryEdit, name: e.target.value })
                }
              />
            </label>
            <label>
              Dostupné množstvo
              <input
                type="number"
                min="0"
                step=".0001"
                value={pantryEdit.quantity}
                onChange={(e) =>
                  setPantryEdit({
                    ...pantryEdit,
                    quantity: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Jednotka
              <select
                aria-label="Jednotka"
                value={pantryEdit.unit}
                onChange={(e) =>
                  setPantryEdit({
                    ...pantryEdit,
                    unit: e.target.value as Pantry["unit"],
                  })
                }
              >
                <option>g</option>
                <option>ml</option>
                <option>ks</option>
              </select>
            </label>
            <label>
              Dátum nákupu
              <input
                type="date"
                value={pantryEdit.purchased_on ?? ""}
                onChange={(e) =>
                  setPantryEdit({
                    ...pantryEdit,
                    purchased_on: e.target.value || null,
                  })
                }
              />
            </label>
            <label>
              Dátum spotreby (ak známy)
              <input
                type="date"
                value={pantryEdit.expires_on ?? ""}
                onChange={(e) =>
                  setPantryEdit({
                    ...pantryEdit,
                    expires_on: e.target.value || null,
                  })
                }
              />
            </label>
            <label>
              Umiestnenie
              <input
                value={pantryEdit.location ?? ""}
                onChange={(e) =>
                  setPantryEdit({ ...pantryEdit, location: e.target.value })
                }
              />
            </label>
            <button disabled={busy}>Uložiť surovinu</button>
            <button type="button" onClick={() => setPantryEdit(null)}>
              Zrušiť
            </button>
          </form>
        </div>
      )}
      {replacement && plan && (
        <div className="planning-overlay">
          <section
            className="planning-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Vymeniť recept"
          >
            <h2>Vymeniť recept</h2>
            <label>
              Nový recept
              <select
                aria-label="Nový recept"
                value={replacement.version}
                onChange={(e) =>
                  setReplacement({ ...replacement, version: e.target.value })
                }
              >
                {latest.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Počet porcií zostane zachovaný. Výber hotových porcií pôvodného
              jedla sa zruší.
            </p>
            <button
              onClick={() => {
                calculate({
                  ...plan,
                  recipes: plan.recipes.map((c, i) =>
                    i === replacement.index
                      ? {
                          ...c,
                          recipe_version_id: replacement.version,
                          from_freezer: 0,
                        }
                      : c,
                  ),
                });
                setReplacement(null);
              }}
            >
              Porovnať zmeny
            </button>
            <button onClick={() => setReplacement(null)}>Zrušiť</button>
          </section>
        </div>
      )}
      {diff && plan && (
        <div className="planning-overlay">
          <section
            className="planning-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Zmeny nákupu"
          >
            <h2>Kontrola prepočtu</h2>
            <label>
              <input
                type="checkbox"
                checked={syncCalendar}
                onChange={(e) => setSyncCalendar(e.target.checked)}
              />{" "}
              Pri prepojených receptoch synchronizovať výmenu aj do kalendára
              pri uložení
            </label>
            {diff.plan.items.map((i) => {
              const old = plan.items.find((x) => x.id === i.id);
              return (
                <p key={i.id}>
                  {i.name}: {old?.quantity ?? 0} → {i.quantity} {i.unit}
                  {i.manual ? " · manuálna položka zachovaná" : ""}
                </p>
              );
            })}
            {plan.items
              .filter((i) => !diff.plan.items.some((x) => x.id === i.id))
              .map((i) => (
                <p key={i.id}>
                  Odstránená požiadavka: {i.name} ({i.quantity} {i.unit})
                </p>
              ))}
            {diff.conflicts.map((c) => (
              <p role="alert" key={c}>
                {c}
              </p>
            ))}
            <p>
              Neznáme prevody medzi g / ml / kusmi zostávajú oddelené. Žiadny
              skladový pohyb sa nevykoná.
            </p>
            <button
              onClick={() => {
                setPlan({
                  ...diff.plan,
                  calendar_changes: syncCalendar
                    ? diff.plan.recipes.flatMap((c) => {
                        const source = mealEntries.find(
                          (e) => e.id === c.meal_entry_id,
                        );
                        return source &&
                          source.recipe_version_id !== c.recipe_version_id
                          ? [
                              {
                                ...source,
                                portions: Number(source.portions),
                                recipe_version_id: c.recipe_version_id,
                                ready_portions: 0,
                                batch_portions: 0,
                              },
                            ]
                          : [];
                      })
                    : undefined,
                });
                setNeedsCalculation(false);
                setDiff(null);
              }}
            >
              Prijať prepočet
            </button>
            <button onClick={() => setDiff(null)}>Zrušiť prepočet</button>
          </section>
        </div>
      )}
    </div>
  );
}
