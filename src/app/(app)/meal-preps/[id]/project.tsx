"use client";
import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  prepStatuses,
  prepChoices,
  type ProjectRecipe,
  type PrepDocument,
} from "@/lib/meal-prep";
import {
  shoppingRequirements,
  reconcileShopping,
  pragueToday,
  shoppingText,
  shoppingCsv,
  type PlanningRecipe,
  type Pantry,
  type ShoppingPlan,
  type Meal,
} from "@/lib/planning";
import { money } from "@/lib/domain";
import type { RecipeRecord } from "@/lib/recipes";
import "../meal-preps.css";
type Library = RecipeRecord & PlanningRecipe;
type State = {
  project: {
    id: string;
    name: string;
    description: string;
    source: PrepDocument;
    cooking_date: string;
    days: number;
    target_portions: number;
    status: keyof typeof prepStatuses;
    revision: number;
    initialised: boolean;
  };
  rows: ProjectRecipe[];
  plan: ShoppingPlan;
  calendar: { entry_id: string }[];
};
export default function Project({
  state,
  recipes,
  latest,
  pantry,
  aliases,
  receipts,
  batches,
  batchLinks,
  packages,
}: {
  state: State;
  recipes: Library[];
  latest: string[];
  pantry: Pantry[];
  aliases: Record<string, string>;
  batches: {
    id: string;
    recipe_version_id: string;
    weight_g: number;
    created_at: string;
  }[];
  batchLinks: {
    batch_id: string;
    project_recipe_id: string;
    actual_portions: number;
  }[];
  packages: {
    id: string;
    batch_id: string;
    name: string;
    remaining_g: number;
  }[];
  receipts: { id: string; total_minor: number; receipt_date: string }[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(state.rows),
    [items, setItems] = useState(state.plan.items),
    [status, setStatus] = useState(state.project.status),
    [receipt, setReceipt] = useState(state.plan.receipt_id ?? ""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      state.project.initialised ? "Projekt a nákup sú uložené." : "",
    ),
    [manualName, setManualName] = useState(""),
    [manualQuantity, setManualQuantity] = useState(1),
    [manualUnit, setManualUnit] = useState<"g" | "ml" | "ks">("ks"),
    [addVersion, setAddVersion] = useState(latest[0] ?? ""),
    [batchChoice, setBatchChoice] = useState<Record<string, string>>({}),
    [actualPortions, setActualPortions] = useState<Record<string, number>>({}),
    [calendar, setCalendar] = useState<{
      meals: Meal[];
      conflicts: string[];
      applied: boolean;
    } | null>(null);
  const uuid = () => crypto.randomUUID();
  const r = (id: string) => recipes.find((r) => r.id === id)!;
  const calculation = useMemo(() => {
    try {
      const requirements = shoppingRequirements(
        prepChoices(rows),
        recipes,
        pantry,
        state.project.cooking_date > pragueToday()
          ? state.project.cooking_date
          : pragueToday(),
        aliases,
      );
      return {
        ...reconcileShopping(requirements, items, () => crypto.randomUUID()),
        error: "",
      };
    } catch (e) {
      return {
        items: [],
        conflicts: [],
        error: e instanceof Error ? e.message : "Výpočet zlyhal.",
      };
    }
  }, [rows, recipes, pantry, aliases, items, state.project.cooking_date]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  function updateRows(next: ProjectRecipe[]) {
    setRows(next);
    setDirty(true);
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/meal-preps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          request: uuid(),
          data: {
            id: state.project.id,
            revision: state.project.revision,
            rows: rows.map(
              ({ id, local_key, recipe_version_id, portions }) => ({
                id,
                local_key,
                recipe_version_id,
                portions,
              }),
            ),
            status,
            manual: calculation.items
              .filter((i) => i.manual)
              .map(({ id, name, unit, quantity, checked }) => ({
                id,
                name,
                unit,
                quantity,
                checked,
              })),
            checks: Object.fromEntries(
              calculation.items.map((i) => [i.id, i.checked]),
            ),
            receipt_id: receipt || null,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setDirty(false);
      setMessage("Projekt aj spoločný nákup sú uložené.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Uloženie zlyhalo.");
    } finally {
      setBusy(false);
    }
  }
  async function calendarAction(apply = false) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/meal-preps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: apply ? "calendar" : "calendar_preview",
          request: uuid(),
          id: state.project.id,
          revision: state.project.revision,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      if (apply) {
        setCalendar(null);
        router.refresh();
        setMessage(
          "Jedlá boli pridané do voľných slotov. Zásoby zostali nezmenené.",
        );
      } else setCalendar(result);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Plánovanie zlyhalo.");
    } finally {
      setBusy(false);
    }
  }
  function exportFile(csv: boolean) {
    const plan = {
      ...state.plan,
      recipes: prepChoices(rows),
      items: calculation.items,
    };
    const blob = new Blob([csv ? shoppingCsv(plan) : shoppingText(plan)], {
      type: csv ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = csv ? "meal-prep-nakup.csv" : "meal-prep-nakup.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function linkBatch(row: ProjectRecipe) {
    setBusy(true);
    try {
      const result = await fetch("/api/meal-preps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch",
          request: uuid(),
          id: state.project.id,
          row: row.id,
          batch: batchChoice[row.id],
          portions: actualPortions[row.id] ?? row.portions,
        }),
      });
      const data = await result.json();
      if (!result.ok) throw Error(data.error);
      router.refresh();
      setMessage(
        "Skutočná várka je prepojená. Nový skladový príjem sa nevytvoril.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Prepojenie zlyhalo.");
    } finally {
      setBusy(false);
    }
  }
  const total = rows.reduce(
    (s, row) =>
      s +
      (row.details?.estimated_cost_minor === undefined
        ? 0
        : Math.round(
            (row.details.estimated_cost_minor * row.portions) /
              row.details.planned_portions,
          )),
    0,
  );
  const missing = rows.filter(
    (row) => row.details?.estimated_cost_minor === undefined,
  ).length;
  const locked = state.project.status !== "planned";
  return (
    <section className="recipe-page prep-page">
      <Link href="/meal-preps">← Meal prepy</Link>
      <p className="eyebrow">SPOLOČNÝ PLÁN, JEDNA KUCHYŇA</p>
      <h1>{state.project.name}</h1>
      <p>{state.project.description}</p>
      <p>
        Varenie {state.project.cooking_date} · {state.project.days} dní · cieľ{" "}
        {state.project.target_portions} hlavných porcií. Prílohy sa nerátajú ako
        ďalšie samostatné jedlá.
      </p>
      <label>
        Stav projektu
        <select
          aria-label="Stav projektu"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as keyof typeof prepStatuses);
            setDirty(true);
          }}
        >
          {Object.entries(prepStatuses).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <p>
        Stav je organizačné označenie. „Nakúpený“ nepotvrdzuje finančný výdavok;
        „Zamrazený“ nevytvára skladové balíčky.
      </p>
      <nav className="prep-actions" aria-label="Časti meal-prepu">
        <a href="#prep-shopping">Nákupný zoznam ↓</a>
        <a href="#prep-recipes">Jedlá a postupy ↓</a>
        <a href="#prep-timeline">Harmonogram ↓</a>
      </nav>
      <div className="prep-actions">
        <button
          disabled={busy || !rows.length || !!calculation.error}
          onClick={save}
        >
          Uložiť projekt a nákup
        </button>
        <button
          disabled={busy || dirty || !!state.calendar.length}
          onClick={() => calendarAction()}
        >
          Pripraviť jedálniček — náhľad
        </button>
        <Link href="/food-cost/receipts/new">Zaevidovať skutočnú účtenku</Link>
        <Link href="/portioning">Skutočné várky a štítky 50 × 30 mm</Link>
      </div>
      {state.calendar.length > 0 && (
        <p>
          Projekt už má prepojenie na jedálniček. Neskoršie úpravy projektu
          automaticky nemenia existujúce naplánované jedlá; skontrolujte ich v
          jedálničku.
        </p>
      )}
      {dirty && (
        <p className="planning-dirty">
          Máte neuložené zmeny. Nákupný návrh sa už prepočítal; uložte projekt
          pred odchodom.
        </p>
      )}
      <p role="status">{message}</p>
      {!state.project.initialised && (
        <p role="alert">
          Import projektu je zachovaný. Pre dokončenie prvého nákupného výpočtu
          kliknite na Uložiť projekt a nákup.
        </p>
      )}
      {locked && (
        <p>
          Po nákupe sú recepty uzamknuté. Zmeny receptov riešte samostatným
          doplnkovým projektom.
        </p>
      )}
      <div className="prep-grid">
        <div>
          <h2 id="prep-recipes">Jedlá a porcie</h2>
          {rows.map((row, index) => {
            const recipe = r(row.recipe_version_id);
            return (
              <article className="card" key={row.id}>
                <div className="prep-recipe-head">
                  <div>
                    {recipe.photo && (
                      <Image
                        unoptimized
                        src={recipe.photo}
                        width={80}
                        height={80}
                        alt=""
                      />
                    )}
                    <h3>{recipe.name}</h3>
                    <Link href={"/meal-plan/recipe/" + recipe.id}>
                      Otvoriť presnú verziu receptu →
                    </Link>
                  </div>
                  <label>
                    Pripraviť porcií
                    <input
                      aria-label={"Porcie " + row.local_key}
                      disabled={locked}
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.01"
                      value={row.portions}
                      onChange={(e) =>
                        updateRows(
                          rows.map((old, i) =>
                            i === index
                              ? { ...old, portions: Number(e.target.value) }
                              : old,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <label>
                  Vymeniť recept
                  <select
                    aria-label={"Vymeniť recept " + row.local_key}
                    disabled={locked}
                    value={row.recipe_version_id}
                    onChange={(e) =>
                      updateRows(
                        rows.map((old, i) =>
                          i === index
                            ? {
                                ...old,
                                recipe_version_id: e.target.value,
                                details: null,
                              }
                            : old,
                        ),
                      )
                    }
                  >
                    {recipes
                      .filter(
                        (v) =>
                          latest.includes(v.id) ||
                          v.id === row.recipe_version_id,
                      )
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="prep-actions">
                  <button
                    disabled={locked || rows.length <= 1}
                    onClick={() =>
                      updateRows(rows.filter((old) => old.id !== row.id))
                    }
                  >
                    Odstrániť recept z projektu
                  </button>
                  <Link href={"/recipes/" + recipe.id + "/batch"}>
                    Navariť — potvrdiť skutočný výťažok
                  </Link>
                  {recipe.freezing && (
                    <Link href={"/portioning?version=" + recipe.id}>
                      Formy, vákuovanie a QR balíčky
                    </Link>
                  )}
                </div>
                <p>
                  {recipe.prep_minutes
                    ? `Príprava ${recipe.prep_minutes} min · `
                    : ""}
                  {recipe.cooking_minutes_min
                    ? `Varenie / pečenie približne ${recipe.cooking_minutes_min}–${recipe.cooking_minutes_max ?? recipe.cooking_minutes_min} min · `
                    : ""}
                  {recipe.oven_c ? `Rúra ${recipe.oven_c} °C` : ""}
                </p>
                <p>
                  Odhad ceny porcie:{" "}
                  {row.details?.estimated_cost_minor === undefined
                    ? "neznámy"
                    : money(
                        Math.round(
                          row.details.estimated_cost_minor /
                            row.details.planned_portions,
                        ),
                      ) + " (AI odhad, nie skutočný náklad)"}
                </p>
                {row.details?.active_minutes && (
                  <p>
                    Aktívna práca: približne {row.details.active_minutes} min
                  </p>
                )}
                <details>
                  <summary>Prepojiť skutočne uvarenú várku</summary>
                  <p>
                    Najprv vytvorte várku cez Navariť alebo Formy. Tu potvrďte
                    jej skutočný počet porcií. Toto prepojenie nepohybuje
                    skladom.
                  </p>
                  <label>
                    Skutočná várka
                    <select
                      aria-label={"Skutočná várka " + row.local_key}
                      value={batchChoice[row.id] ?? ""}
                      onChange={(e) =>
                        setBatchChoice({
                          ...batchChoice,
                          [row.id]: e.target.value,
                        })
                      }
                    >
                      <option value="">Vyberte vlastnú várku</option>
                      {batches
                        .filter(
                          (b) =>
                            b.recipe_version_id === row.recipe_version_id &&
                            !batchLinks.some((l) => l.batch_id === b.id),
                        )
                        .map((b) => (
                          <option value={b.id} key={b.id}>
                            {b.created_at.slice(0, 10)} · {b.weight_g} g ·{" "}
                            {b.id.slice(0, 8)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Skutočne pripravené porcie
                    <input
                      aria-label={"Skutočné porcie " + row.local_key}
                      type="number"
                      min="0.01"
                      max="100"
                      value={actualPortions[row.id] ?? row.portions}
                      onChange={(e) =>
                        setActualPortions({
                          ...actualPortions,
                          [row.id]: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <button
                    disabled={busy || dirty || !batchChoice[row.id]}
                    onClick={() => linkBatch(row)}
                  >
                    Potvrdiť prepojenie skutočnej várky
                  </button>
                  {batchLinks
                    .filter((l) => l.project_recipe_id === row.id)
                    .map((l) => (
                      <div key={l.batch_id}>
                        <p>
                          Potvrdené: {l.actual_portions} porcií · várka{" "}
                          {l.batch_id.slice(0, 8)}
                        </p>
                        {packages
                          .filter((p) => p.batch_id === l.batch_id)
                          .map((p) => (
                            <p key={p.id}>
                              <Link href={"/inventory?id=" + p.id}>
                                {p.name} · {p.remaining_g} g
                              </Link>{" "}
                              ·{" "}
                              <Link href={"/labels/" + p.id}>
                                Štítok 50 × 30 mm (PNG/PDF)
                              </Link>
                            </p>
                          ))}
                      </div>
                    ))}
                </details>
                <h4>Suroviny na {row.portions} porcií</h4>
                <ul>
                  {recipe.ingredients.map((i, n) => (
                    <li key={n}>
                      {i.name}:{" "}
                      {Math.round(
                        ((i.quantity * row.portions) / recipe.portions) * 100,
                      ) / 100}{" "}
                      {i.unit}
                    </li>
                  ))}
                </ul>
                <h4>Postup</h4>
                <ol>
                  {recipe.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                {row.details ? (
                  <>
                    <h4>Porciovanie a mrazenie</h4>
                    <p>{row.details.portioning.description}</p>
                    <p>
                      Odporúčané objemy:{" "}
                      {row.details.portioning.mold_ml.join(" / ")} ml. Objem nie
                      je hmotnosť.
                    </p>
                    <p>
                      <strong>Schladenie:</strong>{" "}
                      {row.details.preservation.cooling}
                    </p>
                    <p>
                      <strong>Mrazenie:</strong>{" "}
                      {row.details.preservation.freezing}
                    </p>
                    <p>
                      <strong>Vákuovanie:</strong>{" "}
                      {row.details.preservation.vacuuming}
                    </p>
                    <p>
                      <strong>Rozmrazovanie:</strong>{" "}
                      {row.details.preservation.thawing}
                    </p>
                    <p>
                      Deklarované alergény autora:{" "}
                      {row.details.allergens.join(", ") || "neuvedené"}. Overte
                      skutočné výrobky a krížovú kontamináciu; prázdny zoznam
                      nezaručuje neprítomnosť alergénov.
                    </p>
                    {row.details.source_url && (
                      <a
                        href={row.details.source_url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Zdroj receptu
                      </a>
                    )}
                    {row.details.notes && <p>{row.details.notes}</p>}
                  </>
                ) : (
                  <p>
                    Pôvodné AI pokyny sa po výmene neprenášajú na iné jedlo.
                    Použite pokyny vybratej receptovej verzie a existujúce
                    porciovanie.
                  </p>
                )}
                <h4>Skladovanie</h4>
                <p>{recipe.storage}</p>
                <h4>Ohrev</h4>
                <p>{recipe.reheating}</p>
              </article>
            );
          })}
          {!locked && (
            <section className="card">
              <label>
                Pridať recept
                <select
                  aria-label="Pridať recept do meal-prepu"
                  value={addVersion}
                  onChange={(e) => setAddVersion(e.target.value)}
                >
                  {recipes
                    .filter((r) => latest.includes(r.id))
                    .map((r) => (
                      <option value={r.id} key={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={!addVersion}
                onClick={() =>
                  updateRows([
                    ...rows,
                    {
                      id: uuid(),
                      local_key:
                        "added_" + uuid().replaceAll("-", "").slice(0, 12),
                      recipe_version_id: addVersion,
                      portions: r(addVersion).portions,
                      details: null,
                    },
                  ])
                }
              >
                Pridať do projektu
              </button>
            </section>
          )}
          <section className="card">
            <h2 id="prep-timeline">Harmonogram varenia</h2>
            <p>
              Časy sú orientačné; vychádzajú z pôvodného AI návrhu. Pri výmene
              receptov treba harmonogram skontrolovať.
            </p>
            <ol>
              {state.project.source.timeline
                .filter((t) =>
                  t.recipe_keys.some((k) =>
                    rows.some((r) => r.local_key === k),
                  ),
                )
                .map((t) => (
                  <li key={t.key}>
                    <strong>+{t.start_minute} min:</strong> {t.label} (
                    {t.duration_minutes} min)
                    {t.recipe_keys.some((k) =>
                      rows.some((r) => r.local_key === k && !r.details),
                    ) && (
                      <p>
                        Recept bol vymenený — pôvodný krok treba upraviť podľa
                        nového receptu.
                      </p>
                    )}
                  </li>
                ))}
            </ol>
          </section>
        </div>
        <aside>
          <section className="prep-summary">
            <h2 id="prep-shopping">Spoločný nákup</h2>
            <p>
              Vypočítané zo všetkých aktuálne vybraných receptových verzií.
              Použiteľné zásoby špajze sú odpočítané bez skladového odpisu.
            </p>
            {calculation.error && <p role="alert">{calculation.error}</p>}
            {calculation.conflicts.map((c) => (
              <p role="alert" key={c}>
                {c}
              </p>
            ))}
            {calculation.items.map((item) => (
              <div className="prep-check" key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => {
                      setItems(
                        calculation.items.map((i) =>
                          i.id === item.id
                            ? { ...i, checked: e.target.checked }
                            : i,
                        ),
                      );
                      setDirty(true);
                    }}
                  />
                  {item.name}{" "}
                  <strong>
                    {Math.round(item.quantity * 100) / 100} {item.unit}
                  </strong>
                  {item.manual
                    ? " · ručne pridané"
                    : ` · potreba ${Math.round(item.required * 100) / 100} ${item.unit}`}
                </label>
                {item.manual && (
                  <button
                    onClick={() => {
                      setItems(
                        calculation.items.filter((i) => i.id !== item.id),
                      );
                      setDirty(true);
                    }}
                  >
                    Odobrať
                  </button>
                )}
              </div>
            ))}
            <h3>Manuálna položka</h3>
            <label>
              Názov položky
              <input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                maxLength={160}
              />
            </label>
            <label>
              Množstvo
              <input
                type="number"
                min="0"
                value={manualQuantity}
                onChange={(e) => setManualQuantity(Number(e.target.value))}
              />
            </label>
            <label>
              Jednotka
              <select
                value={manualUnit}
                onChange={(e) =>
                  setManualUnit(e.target.value as "g" | "ml" | "ks")
                }
              >
                <option value="ks">ks</option>
                <option value="g">g</option>
                <option value="ml">ml</option>
              </select>
            </label>
            <button
              disabled={!manualName.trim()}
              onClick={() => {
                setItems([
                  ...calculation.items,
                  {
                    id: uuid(),
                    ingredient_key: manualName.toLowerCase(),
                    name: manualName.trim(),
                    unit: manualUnit,
                    quantity: manualQuantity,
                    manual: true,
                    required: 0,
                    checked: false,
                    origins: [],
                    selection: null,
                  },
                ]);
                setManualName("");
                setDirty(true);
              }}
            >
              Pridať manuálnu položku
            </button>
            <div className="prep-actions">
              <button onClick={() => exportFile(false)}>Export TXT</button>
              <button onClick={() => exportFile(true)}>Export CSV</button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      shoppingText({
                        ...state.plan,
                        recipes: prepChoices(rows),
                        items: calculation.items,
                      }),
                    );
                    setMessage("Nákup je skopírovaný.");
                  } catch {
                    setMessage("Použite export TXT.");
                  }
                }}
              >
                Kopírovať nákup
              </button>
            </div>
            <h3>Náklady</h3>
            <p className="prep-cost">
              {missing === rows.length
                ? "Odhad neznámy"
                : (missing ? "Čiastočný odhad: " : "AI odhad: ") + money(total)}
            </p>
            <p>
              {missing > 0 ? `${missing} receptov nemá známu cenu. ` : ""}Toto
              nie je zaplatený nákup ani skutočná cena uvarenej porcie.
            </p>
            <label>
              Prepojiť potvrdenú účtenku
              <select
                aria-label="Prepojiť potvrdenú účtenku"
                value={receipt}
                onChange={(e) => {
                  setReceipt(e.target.value);
                  setDirty(true);
                }}
              >
                <option value="">Bez skutočného dokladu</option>
                {receipts.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.receipt_date} · {money(r.total_minor)} ·{" "}
                    {r.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            {receipt && (
              <p>
                Skutočne zaplatené podľa dokladu:{" "}
                {receipts.find((r) => r.id === receipt)
                  ? money(receipts.find((r) => r.id === receipt)!.total_minor)
                  : "suma nie je dostupná"}
                . Môže zahŕňať aj iný tovar; nejde o cenu porcií tohto projektu.
              </p>
            )}
            <Link href="/food-cost">Skutočné výdavky vo Food Cost →</Link>
          </section>
        </aside>
      </div>
      {calendar && (
        <section
          className="card"
          role="dialog"
          aria-modal="false"
          aria-label="Náhľad jedálnička"
        >
          <h2>Prepojenie na jedálniček</h2>
          {calendar.meals.map((m) => (
            <p key={m.id}>
              {m.meal_date} · {m.slot} · {r(m.recipe_version_id)?.name}{" "}
              {m.components?.map((c) => " + " + r(c.recipe_version_id)?.name)} ·{" "}
              {m.portions} porcie
            </p>
          ))}
          {calendar.conflicts.map((c) => (
            <p role="alert" key={c}>
              Obsadený slot: {c}
            </p>
          ))}
          <p>
            Pridajú sa iba nové plánované jedlá a plánované várky. Sklad zostane
            nezmenený. Pri neznámej role alebo nepotvrdenej kompatibilite najprv
            zatriedite recepty a vyberiete ich nové verzie v projekte.
          </p>
          <button
            disabled={
              busy ||
              !calendar.meals.length ||
              calendar.conflicts.length > 0 ||
              calendar.applied
            }
            onClick={() => calendarAction(true)}
          >
            Potvrdiť pridanie do jedálnička
          </button>
          <button onClick={() => setCalendar(null)}>Zrušiť</button>
        </section>
      )}
    </section>
  );
}
