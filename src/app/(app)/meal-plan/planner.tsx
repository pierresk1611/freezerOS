"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  addDays,
  monday,
  pragueToday,
  slots,
  generateMeals,
  type Meal,
  type PlanningRecipe,
} from "@/lib/planning";
export default function Planner({
  start,
  initial,
  recipes,
  latest,
  available,
  quality,
  recent,
  ready,
  settings,
  previous,
}: {
  settings: {
    revision?: number;
    cookingDays?: number;
    batchPortions?: number;
    sideVersion?: string;
    budgetMinor?: number;
    persons?: number;
    perDay?: number;
    days?: number;
    priority?: string;
    banned?: string[];
  };
  previous: Meal[];
  start: string;
  initial: Meal[];
  recipes: PlanningRecipe[];
  latest: PlanningRecipe[];
  available: Record<string, number | null>;
  quality: Record<string, string>;
  recent: string[];
  ready: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<Meal | null>(null),
    [query, setQuery] = useState(""),
    [stockOnly, setStockOnly] = useState(false),
    [preview, setPreview] = useState<Meal[] | null>(null),
    [generate, setGenerate] = useState(false),
    [persons, setPersons] = useState(settings.persons ?? 1),
    [perDay, setPerDay] = useState(settings.perDay ?? 2),
    [banned, setBanned] = useState((settings.banned ?? []).join("\n")),
    [days, setDays] = useState(settings.days ?? 7),
    [priority, setPriority] = useState(settings.priority ?? "variety"),
    [cookingDays, setCookingDays] = useState(settings.cookingDays ?? 7),
    [batchPortions, setBatchPortions] = useState(settings.batchPortions ?? 1),
    [sideVersion, setSideVersion] = useState(settings.sideVersion ?? ""),
    [budget, setBudget] = useState(
      settings.budgetMinor !== undefined
        ? String(settings.budgetMinor / 100)
        : "",
    );
  async function save(changes: (Meal & { remove?: boolean })[]) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/planning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: crypto.randomUUID(),
          action: "meals",
          data: changes,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setEdit(null);
      setPreview(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const original = initial.find((e) => e.id === edit?.id);
  const oldRecipe = recipes.find((r) => r.id === original?.recipe_version_id);
  const newRecipe = recipes.find((r) => r.id === edit?.recipe_version_id);
  return (
    <div className="recipe-page planner-page">
      <header>
        <p className="eyebrow">Váš týždeň pri stole</p>
        <h1>Jedálniček</h1>
        <p>Plánujte slobodne. Sklad sa mení až pri zaznamenanej konzumácii.</p>
      </header>
      {!ready && (
        <p role="alert">
          Nové úpravy vyžadujú aktiváciu migrácie 009. Existujúci plán zostáva
          zachovaný.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <nav className="planning-toolbar">
        <Link href={"?week=" + addDays(start, -7)}>← Predchádzajúci</Link>
        <Link href={"?week=" + monday(pragueToday())}>Tento týždeň</Link>
        <Link href={"?week=" + addDays(start, 7)}>Nasledujúci →</Link>
        <Link href={"/shopping?week=" + start}>Vytvoriť nákup</Link>
      </nav>
      <div className="planning-toolbar">
        <button
          disabled={!ready || busy}
          onClick={() =>
            setEdit({
              id: crypto.randomUUID(),
              recipe_version_id: latest[0]?.id ?? "",
              meal_date: start,
              slot: "lunch",
              portions: 1,
            })
          }
        >
          Pridať jedlo
        </button>
        <button disabled={!ready} onClick={() => setGenerate(!generate)}>
          Navrhnúť týždeň
        </button>
        <button
          disabled={!ready || !initial.length}
          onClick={() =>
            setPreview(
              initial.map((e) => ({
                ...e,
                id: crypto.randomUUID(),
                revision: undefined,
                meal_date: addDays(e.meal_date, 7),
              })),
            )
          }
        >
          Kopírovať do ďalšieho týždňa
        </button>
        <button
          disabled={!ready || !previous.length}
          onClick={() =>
            setPreview(
              previous.map((e) => ({
                ...e,
                id: crypto.randomUUID(),
                revision: undefined,
                meal_date: addDays(e.meal_date, 7),
              })),
            )
          }
        >
          Duplikovať minulý týždeň
        </button>
      </div>
      {generate && (
        <section className="card">
          <h2>Návrh pred uložením</h2>
          <label>
            Počet osôb
            <input
              type="number"
              min="1"
              max="20"
              value={persons}
              onChange={(e) => setPersons(Number(e.target.value))}
            />
          </label>
          <label>
            Jedál denne
            <select
              aria-label="Jedál denne"
              value={perDay}
              onChange={(e) => setPerDay(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            Počet dní
            <input
              type="number"
              min="1"
              max="14"
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value));
                setCookingDays((n) => Math.min(n, Number(e.target.value)));
              }}
            />
          </label>
          <label>
            Priorita
            <select
              aria-label="Priorita"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="variety">Rozmanitosť</option>
              <option value="favorites">Obľúbené jedlá</option>
              <option value="stock">Dostupné hotové porcie</option>
              <option value="economic">Úsporný nákup podľa známych cien</option>
            </select>
          </label>
          <label>
            Dní varenia
            <input
              type="number"
              min="0"
              max={days}
              value={Math.min(cookingDays, days)}
              onChange={(e) => setCookingDays(Number(e.target.value))}
            />
          </label>
          <label>
            Dní s hotovým jedlom
            <input
              type="number"
              min="0"
              max={days}
              value={Math.max(0, days - cookingDays)}
              onChange={(e) => setCookingDays(days - Number(e.target.value))}
            />
          </label>
          <label>
            Preferované porcie jednej várky
            <input
              type="number"
              min="1"
              max="100"
              value={batchPortions}
              onChange={(e) => setBatchPortions(Number(e.target.value))}
            />
          </label>
          <label>
            Príloha (voliteľné)
            <select
              aria-label="Príloha (voliteľné)"
              value={sideVersion}
              onChange={(e) => setSideVersion(e.target.value)}
            >
              <option value="">Bez samostatnej prílohy</option>
              {latest.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Maximálny orientačný rozpočet (Kč, voliteľné)
            <input
              type="number"
              min="0"
              step=".01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>
          <p>
            Rozpočet sa dá skontrolovať iba pri úplných historických cenách.
            Nové nákupné balenia a manuálne položky ho môžu zmeniť.
          </p>
          <label>
            Tvrdé zákazy – jedna surovina alebo výraz na riadok
            <textarea
              value={banned}
              onChange={(e) => setBanned(e.target.value)}
            />
          </label>
          <p>
            Zohľadníme obľúbenosť, opakovanie v pláne a posledných 14 dní
            konzumácie. Ceny ani kalórie nedopĺňame odhadom.
          </p>
          <button
            onClick={() => {
              try {
                if (!Number.isInteger(persons) || persons < 1 || persons > 20)
                  throw Error("Zadajte 1 až 20 osôb.");
                if (!Number.isInteger(days) || days < 1 || days > 14)
                  throw Error("Zadajte 1 až 14 dní.");
                if (
                  budget !== "" &&
                  (!Number.isFinite(Number(budget)) || Number(budget) < 0)
                )
                  throw Error("Neplatný rozpočet.");
                if (
                  !Number.isInteger(cookingDays) ||
                  cookingDays < 0 ||
                  cookingDays > days
                )
                  throw Error("Dni varenia musia byť v rozsahu plánu.");
                if (
                  !Number.isInteger(batchPortions) ||
                  batchPortions < 1 ||
                  batchPortions > 100
                )
                  throw Error("Neplatná veľkosť várky.");
                setPreview(
                  generateMeals(
                    latest.map((r) => ({
                      ...r,
                      preference:
                        priority === "favorites"
                          ? (r.preference ?? 0) * 3
                          : priority === "stock"
                            ? typeof available[r.recipe_id] === "number" &&
                              Number(available[r.recipe_id]) >= persons
                              ? 4
                              : 0
                            : (r.preference ?? 0),
                    })),
                    start,
                    days,
                    persons,
                    perDay,
                    initial.map((e) => ({
                      ...e,
                      recipe_version_id:
                        latest.find(
                          (l) =>
                            l.recipe_id ===
                            recipes.find((r) => r.id === e.recipe_version_id)
                              ?.recipe_id,
                        )?.id ?? e.recipe_version_id,
                    })),
                    recent,
                    banned
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    () => crypto.randomUUID(),
                    {
                      available,
                      quality,
                      cookingDays,
                      batchPortions,
                      sideVersion: sideVersion || undefined,
                      budgetMinor:
                        budget !== ""
                          ? Math.round(Number(budget) * 100)
                          : undefined,
                      economic: priority === "economic",
                    },
                  ),
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Zobraziť návrh
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await fetch("/api/planning", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    request: crypto.randomUUID(),
                    action: "settings",
                    data: {
                      revision: settings.revision,
                      cookingDays,
                      batchPortions,
                      sideVersion: sideVersion || undefined,
                      budgetMinor:
                        budget !== ""
                          ? Math.round(Number(budget) * 100)
                          : undefined,
                      persons,
                      perDay,
                      days,
                      priority,
                      banned: banned
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  }),
                });
                const data = await r.json();
                if (!r.ok) throw Error(data.error);
                setGenerate(false);
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Uložiť nastavenia a obmedzenia
          </button>
        </section>
      )}
      {preview && (
        <section className="card">
          <h2>Náhľad {preview.length} jedál</h2>
          <p>
            Nové jedlá sa pridajú k existujúcemu plánu. Hotové porcie sú návrh
            použitia, nie skladová rezervácia.
          </p>
          {budget !== "" &&
            preview.some(
              (e) =>
                recipes.find((r) => r.id === e.recipe_version_id)
                  ?.estimated_cost_minor === undefined,
            ) && (
              <p role="alert">
                Niektoré ceny chýbajú. Zadaný rozpočet preto nemožno overiť.
              </p>
            )}
          {preview.map((e) => (
            <p key={e.id}>
              {e.meal_date} · {slots[e.slot]} ·{" "}
              {recipes.find((r) => r.id === e.recipe_version_id)?.name} ·{" "}
              {e.portions} porcií{" "}
              {e.ready_portions
                ? ` · použiť ${e.ready_portions} hotových porcií`
                : ` · navariť ${e.batch_portions || e.portions} porcií`}
            </p>
          ))}
          <button disabled={busy} onClick={() => save(preview)}>
            Potvrdiť plán
          </button>
          <button onClick={() => setPreview(null)}>Zrušiť návrh</button>
        </section>
      )}
      <nav className="planner-days" aria-label="Prejsť na deň">
        {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map(
          (day, i) => (
            <a key={day} href={"#day-" + day}>
              {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"][i]}{" "}
              {Number(day.slice(-2))}
            </a>
          ),
        )}
      </nav>
      <div className="week-calendar">
        {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => (
          <section className="planning-day" key={day} id={"day-" + day}>
            <h2>
              {new Intl.DateTimeFormat("sk", {
                weekday: "long",
                day: "numeric",
                month: "numeric",
                timeZone: "Europe/Prague",
              }).format(new Date(day + "T12:00:00Z"))}
            </h2>
            {Object.entries(slots).map(([slot, label]) => (
              <div key={slot}>
                <h3>{label}</h3>
                {initial
                  .filter((e) => e.meal_date === day && e.slot === slot)
                  .map((e) => {
                    const r = recipes.find((r) => r.id === e.recipe_version_id);
                    const amount = available[r?.recipe_id ?? ""];
                    return (
                      <article className="planned-meal" key={e.id}>
                        {r?.photo && (
                          <Image
                            src={r.photo}
                            alt=""
                            width={500}
                            height={300}
                            unoptimized
                          />
                        )}
                        <Link href={"/meal-plan/recipe/" + e.recipe_version_id}>
                          {r?.name ?? "Recept"}
                        </Link>
                        <p>
                          {e.portions} porcií{" "}
                          {e.ready_portions
                            ? ` · použiť ${e.ready_portions} hotových porcií`
                            : ` · navariť ${e.batch_portions || e.portions} porcií`}
                          {r?.prep_minutes
                            ? ` · príprava ${r.prep_minutes} min`
                            : ""}
                        </p>
                        <p>
                          {amount === undefined
                            ? "Treba navariť"
                            : amount === null
                              ? "Zásoba v gramoch; porcie neznáme"
                              : `Evidovaných ${amount.toFixed(2)} porcií (bez rezervácie)`}
                        </p>
                        <button
                          disabled={!ready}
                          onClick={() => {
                            setEdit({ ...e, portions: Number(e.portions) });
                            setQuery("");
                          }}
                        >
                          Vymeniť jedlo
                        </button>
                        <details className="meal-options">
                          <summary>Ďalšie možnosti</summary>
                          <button
                            disabled={!ready}
                            onClick={() => {
                              setEdit({ ...e, portions: Number(e.portions) });
                              setQuery("");
                            }}
                          >
                            Upraviť / presunúť
                          </button>
                          <button
                            disabled={!ready}
                            onClick={() =>
                              setEdit({
                                ...e,
                                id: crypto.randomUUID(),
                                revision: undefined,
                                meal_date: addDays(e.meal_date, 1),
                                portions: Number(e.portions),
                              })
                            }
                          >
                            Kopírovať
                          </button>
                          <button
                            disabled={!ready || busy}
                            onClick={() =>
                              save([
                                {
                                  ...e,
                                  portions: Number(e.portions),
                                  remove: true,
                                },
                              ])
                            }
                          >
                            Odstrániť z plánu
                          </button>
                        </details>
                      </article>
                    );
                  })}
              </div>
            ))}
          </section>
        ))}
      </div>
      {edit && (
        <div className="planning-overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Výber jedla"
            className="planning-sheet"
          >
            <h2>{original ? "Vymeniť jedlo" : "Pridať jedlo"}</h2>
            <label>
              Vyhľadať recept
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              Recept
              <select
                aria-label="Recept"
                value={edit.recipe_version_id}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    recipe_version_id: e.target.value,
                    ready_portions: 0,
                    batch_portions: 0,
                  })
                }
              >
                {recipes
                  .filter(
                    (r) =>
                      r.id === edit.recipe_version_id ||
                      (latest.some((l) => l.id === r.id) &&
                        r.name
                          .toLocaleLowerCase()
                          .includes(query.toLocaleLowerCase())),
                  )
                  .map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={stockOnly}
                onChange={(e) => setStockOnly(e.target.checked)}
              />{" "}
              Len jedlá dostupné v mrazničke
            </label>
            <div className="recipe-alternatives">
              {latest
                .filter(
                  (r) =>
                    r.name
                      .toLocaleLowerCase()
                      .includes(query.toLocaleLowerCase()) &&
                    (!stockOnly || Number(available[r.recipe_id]) > 0),
                )
                .slice(0, 12)
                .map((r) => (
                  <button
                    key={r.id}
                    onClick={() =>
                      setEdit({
                        ...edit,
                        recipe_version_id: r.id,
                        ready_portions: 0,
                        batch_portions: 0,
                      })
                    }
                  >
                    {r.photo && (
                      <Image
                        src={r.photo}
                        alt=""
                        width={140}
                        height={90}
                        unoptimized
                      />
                    )}
                    {r.name}
                  </button>
                ))}
            </div>
            <button
              onClick={() => {
                const candidates = latest.filter(
                  (r) => r.id !== edit.recipe_version_id,
                );
                try {
                  const suggestion = generateMeals(
                    candidates,
                    edit.meal_date,
                    1,
                    Math.max(0.01, edit.portions),
                    1,
                    initial,
                    recent,
                    banned
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    () => crypto.randomUUID(),
                    { quality },
                  )[0];
                  setEdit({
                    ...edit,
                    recipe_version_id: suggestion.recipe_version_id,
                    ready_portions: 0,
                    batch_portions: 0,
                  });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              🎲 Prekvap ma!
            </button>
            <label>
              Deň
              <input
                type="date"
                value={edit.meal_date}
                onChange={(e) =>
                  setEdit({ ...edit, meal_date: e.target.value })
                }
              />
            </label>
            <label>
              Jedlo
              <select
                aria-label="Jedlo"
                value={edit.slot}
                onChange={(e) =>
                  setEdit({ ...edit, slot: e.target.value as Meal["slot"] })
                }
              >
                {Object.entries(slots).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Plánované porcie
              <input
                type="number"
                min=".01"
                max="100"
                step=".01"
                value={edit.portions}
                onChange={(e) =>
                  setEdit({ ...edit, portions: Number(e.target.value) })
                }
              />
            </label>
            {original && (
              <p>
                Pôvodne: {oldRecipe?.name} → {newRecipe?.name}. Dátum a porcie
                zostávajú podľa vyššie uvedených polí.
              </p>
            )}
            <p>
              Suroviny nového výberu:{" "}
              {newRecipe?.ingredients
                .map(
                  (i) =>
                    `${i.name} ${+((i.quantity * edit.portions) / newRecipe.portions).toFixed(2)} ${i.unit}`,
                )
                .join(", ")}
            </p>
            <p>
              {newRecipe?.estimated_cost_minor !== undefined &&
              oldRecipe?.estimated_cost_minor !== undefined
                ? `Orientačný rozdiel podľa historických cien: ${(((newRecipe.estimated_cost_minor / newRecipe.portions - oldRecipe.estimated_cost_minor / oldRecipe.portions) * edit.portions) / 100).toFixed(2)} Kč.`
                : "Cenový rozdiel nie je známy."}{" "}
              Výmena neodpisuje zásoby ani nemení účtenky.
            </p>
            <div className="planning-toolbar">
              <button
                disabled={
                  busy ||
                  !edit.recipe_version_id ||
                  edit.portions <= 0 ||
                  edit.portions > 100
                }
                onClick={() => save([edit])}
              >
                Potvrdiť jedlo
              </button>
              <button onClick={() => setEdit(null)}>Zrušiť</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
