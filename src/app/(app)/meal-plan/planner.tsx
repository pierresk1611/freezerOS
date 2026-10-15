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
  type Meal,
  type PlannedBatch,
  type PlanningRecipe,
} from "@/lib/planning";
import {
  eligibleMain,
  compatibleSides,
  generateSchedule,
  proposalChanges,
  batchUsage,
  validateSchedule,
} from "@/lib/culinary-planning";
import "./planner.css";
type Change = Meal & { remove?: boolean };
const uuid = () => crypto.randomUUID();
const date = (day: string) =>
  new Intl.DateTimeFormat("sk-SK", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    timeZone: "Europe/Prague",
  }).format(new Date(day + "T12:00:00Z"));
export default function Planner({
  start,
  hardBans,
  initial,
  previous,
  batches,
  recipes,
  latest,
  available,
  quality,
  recent,
  ready,
  linked,
}: {
  hardBans: string[];
  start: string;
  initial: Meal[];
  previous: Meal[];
  batches: PlannedBatch[];
  recipes: PlanningRecipe[];
  latest: PlanningRecipe[];
  available: Record<string, number | null>;
  quality: Record<string, string>;
  recent: string[];
  ready: boolean;
  linked: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<Meal | null>(null),
    [query, setQuery] = useState(""),
    [mainCandidates, setMainCandidates] = useState<string[]>([]),
    [showAll, setShowAll] = useState(false),
    [manual, setManual] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [generating, setGenerating] = useState(false),
    [persons, setPersons] = useState(2),
    [perDay, setPerDay] = useState(2),
    [cookingDays, setCookingDays] = useState(2),
    [yieldPortions, setYield] = useState(6),
    [includeSides, setIncludeSides] = useState(true),
    [banned, setBanned] = useState(hardBans.join("\n")),
    [mode, setMode] = useState<"fill" | "selected" | "replace">("fill"),
    [preview, setPreview] = useState<{
      changes: Change[];
      batches: PlannedBatch[];
      warnings: string[];
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [cookDate, setCookDate] = useState(addDays(start, -1)),
    [cookYield, setCookYield] = useState(6),
    [useBatch, setUseBatch] = useState(false);
  const recipe = (id: string) => recipes.find((r) => r.id === id);
  async function save(
    changes: Change[],
    newBatches: PlannedBatch[] = [],
    automatic = false,
  ) {
    setBusy(true);
    setError("");
    try {
      const retained = initial.filter(
        (e) => !changes.some((c) => c.id === e.id),
      );
      validateSchedule(
        [...retained, ...changes.filter((e) => !e.remove)],
        [
          ...batches.filter((b) => !newBatches.some((n) => n.id === b.id)),
          ...newBatches,
        ],
        recipes,
      );
      const r = await fetch("/api/planning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: uuid(),
          action: "schedule",
          data: { changes, batches: newBatches, automatic },
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setEdit(null);
      setPreview(null);
      setSelected([]);
      setGenerating(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Uloženie zlyhalo.");
    } finally {
      setBusy(false);
    }
  }
  function open(e: Meal) {
    setEdit({ ...e, components: [...(e.components ?? [])] });
    setQuery("");
    setManual(false);
    setUseBatch(false);
    setCookDate(e.meal_date);
    setCookYield(Math.max(6, e.portions));
    setError("");
  }
  function makePreview() {
    setError("");
    try {
      if (mode === "selected" && !selected.length)
        throw Error("Vyberte jedlá, ktoré chcete nahradiť.");
      const context =
        mode === "fill"
          ? initial
          : mode === "selected"
            ? initial.filter((e) => !selected.includes(e.id))
            : [];
      const generated = generateSchedule(
        latest,
        start,
        7,
        persons,
        perDay,
        context,
        recent,
        banned.split("\n").filter(Boolean),
        uuid,
        {
          mainCandidates,
          available,
          quality,
          cookingDays,
          batchPortions: yieldPortions,
          includeSides,
          existingBatches: batches,
        },
      );
      const changes = proposalChanges(generated, initial, mode, selected, uuid);
      const used = new Set(
        changes.flatMap((e) =>
          [e, ...(e.components ?? [])].flatMap((p) =>
            p.planned_batch_id ? [p.planned_batch_id] : [],
          ),
        ),
      );
      setPreview({
        changes,
        batches: generated.batches.filter((b) => used.has(b.id)),
        warnings: generated.warnings,
      });
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Návrh sa nepodaril.");
    }
  }
  function copyWeek() {
    const map = new Map<string, string>();
    const newBatches: PlannedBatch[] = [];
    function copyPart<
      T extends { planned_batch_id?: string | null; ready_portions?: number },
    >(p: T): T {
      if (!p.planned_batch_id) return { ...p, ready_portions: 0 };
      let id = map.get(p.planned_batch_id);
      if (!id) {
        const source = batches.find((b) => b.id === p.planned_batch_id);
        if (!source) throw Error("Chýba pôvodná plánovaná várka.");
        id = uuid();
        map.set(source.id, id);
        newBatches.push({
          ...source,
          id,
          revision: undefined,
          cooking_date: addDays(source.cooking_date, 7),
        });
      }
      return { ...p, planned_batch_id: id, ready_portions: 0 };
    }
    try {
      const changes = previous
        .filter(
          (e) =>
            !initial.some(
              (c) =>
                c.meal_date === addDays(e.meal_date, 7) && c.slot === e.slot,
            ),
        )
        .map((e) => ({
          ...copyPart(e),
          id: uuid(),
          revision: undefined,
          origin: "manual" as const,
          meal_date: addDays(e.meal_date, 7),
          components: e.components?.map(copyPart),
        }));
      setPreview({
        changes,
        batches: newBatches,
        warnings: [
          "Kópia dopĺňa iba prázdne sloty. Hotové zásoby sa neprenášajú automaticky.",
        ],
      });
      setConfirmed(false);
    } catch (e) {
      setError(String(e));
    }
  }
  const name = (e: Meal) =>
    [
      recipe(e.recipe_version_id)?.name ?? "Recept",
      ...(e.components ?? []).map(
        (c) => recipe(c.recipe_version_id)?.name ?? "Príloha",
      ),
    ].join(" + ");
  function sourceLabel(e: Meal) {
    if ((e.ready_portions ?? 0) >= e.portions) {
      const known = available[recipe(e.recipe_version_id)!.recipe_id];
      return typeof known === "number" && known >= e.portions
        ? "Máte v mrazničke"
        : "Overte dostupnosť hotových porcií";
    }
    if (e.planned_batch_id) {
      const b = batches.find((b) => b.id === e.planned_batch_id);
      const first = initial
        .filter((x) => x.planned_batch_id === e.planned_batch_id)
        .sort(
          (a, b) =>
            a.meal_date.localeCompare(b.meal_date) || a.id.localeCompare(b.id),
        )[0];
      return b
        ? (first?.id === e.id ? "Uvariť várku · " : "Z plánovanej várky · ") +
            date(b.cooking_date)
        : "Uvariť várku";
    }
    return "Zdroj ešte nie je potvrdený";
  }
  function editSave() {
    if (!edit) return;
    if (!eligibleMain(recipe(edit.recipe_version_id)!, edit.slot) && !manual) {
      setError(
        "Pre tento recept potvrďte manuálny výber alebo vyberte zatriedené hlavné jedlo.",
      );
      return;
    }
    let updated = { ...edit, origin: "manual" as const };
    const added: PlannedBatch[] = [];
    if (useBatch) {
      const b: PlannedBatch = {
        id: uuid(),
        recipe_version_id: edit.recipe_version_id,
        cooking_date: cookDate,
        portions: cookYield,
      };
      updated = { ...updated, planned_batch_id: b.id, ready_portions: 0 };
      added.push(b);
    }
    save([updated], added);
  }
  return (
    <section className="culinary">
      <header className="planner-heading">
        <div>
          <p className="eyebrow">DOBRÉ JEDLO, POKOJNÝ TÝŽDEŇ</p>
          <h1>Váš jedálniček</h1>
          <p>Hlavné jedlo, vhodné prílohy a varenie do zásoby.</p>
        </div>
        <Link href="/meal-plan/roles">Zatriediť recepty a prílohy</Link>
      </header>
      <nav className="planner-toolbar" aria-label="Týždeň">
        <Link href={"?week=" + addDays(start, -7)}>← Predošlý</Link>
        <strong>
          {date(start)} – {date(addDays(start, 6))}
        </strong>
        <Link href={"?week=" + addDays(start, 7)}>Nasledujúci →</Link>
        <Link href={"?week=" + monday(pragueToday())}>Dnes</Link>
      </nav>
      {!ready && (
        <p role="alert" className="card">
          Pre opravený jedálniček aktivujte migráciu 010. Existujúci plán
          zostáva zachovaný a čitateľný.
        </p>
      )}
      <div className="planner-toolbar">
        <button disabled={!ready} onClick={() => setGenerating(!generating)}>
          Navrhnúť týždeň
        </button>
        <Link className="button" href={"/shopping?week=" + start}>
          Vytvoriť nákup
        </Link>
        <button disabled={!ready || !previous.length} onClick={copyWeek}>
          Kopírovať minulý týždeň
        </button>
        <label>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Zobraziť všetky sloty
        </label>
      </div>
      <p role="alert">{error}</p>
      {latest.some((r) => r.meal_role === "unknown") && (
        <p className="card">
          Niektoré recepty ešte nemajú potvrdenú rolu. Automatický návrh ich
          nepoužije.{" "}
          <Link href="/meal-plan/roles">Skontrolovať zatriedenie</Link>
        </p>
      )}
      {generating && (
        <section className="card">
          <h2>Navrhnúť varenie aj jedlá</h2>
          <div className="planner-fields">
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
              Jedlá denne
              <select
                value={perDay}
                onChange={(e) => setPerDay(Number(e.target.value))}
              >
                <option value="1">Obed</option>
                <option value="2">Obed a večera</option>
                <option value="3">Aj raňajky</option>
                <option value="4">Aj snack</option>
              </select>
            </label>
            <label>
              Dni varenia
              <input
                type="number"
                min="0"
                max="7"
                value={cookingDays}
                onChange={(e) => setCookingDays(Number(e.target.value))}
              />
            </label>
            <label>
              Porcií jednej várky
              <input
                type="number"
                min={persons}
                max="100"
                value={yieldPortions}
                onChange={(e) => setYield(Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            Recepty do návrhu (bez výberu všetky zatriedené)
            <select
              multiple
              aria-label="Recepty do návrhu"
              value={mainCandidates}
              onChange={(e) =>
                setMainCandidates(
                  Array.from(e.target.selectedOptions).map((o) => o.value),
                )
              }
            >
              {latest
                .filter((r) =>
                  ["main", "complete", "breakfast", "snack"].includes(
                    r.meal_role ?? "",
                  ),
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          <p>
            Prvé varenie je v nedeľu pred týždňom, ďalšie dni sú rozložené v
            týždni. Jedna várka môže pokryť viac jedál; zvyšok je návrh na
            zamrazenie.
          </p>
          <label>
            <input
              type="checkbox"
              checked={includeSides}
              onChange={(e) => setIncludeSides(e.target.checked)}
            />
            Navrhovať potvrdené kompatibilné prílohy
          </label>
          <label>
            Tvrdé obmedzenia — po jednom na riadok
            <textarea
              value={banned}
              onChange={(e) => setBanned(e.target.value)}
            />
          </label>
          <label>
            Ako upraviť existujúci týždeň
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="fill">Doplniť iba prázdne sloty</option>
              <option value="selected">Nahradiť označené jedlá</option>
              <option value="replace">
                Nahradiť celý týždeň — vyžaduje potvrdenie
              </option>
            </select>
          </label>
          <button onClick={makePreview}>Zobraziť návrh a rozdiely</button>
        </section>
      )}
      <div className="planner-week">
        {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => (
          <article className="planner-day" key={day}>
            <h2>{date(day)}</h2>
            <div className="planner-day-meals">
              {Object.entries(slots)
                .filter(
                  ([slot]) =>
                    showAll ||
                    slot === "lunch" ||
                    slot === "dinner" ||
                    initial.some((e) => e.meal_date === day && e.slot === slot),
                )
                .map(([slot, label]) => (
                  <section className="planner-slot" key={slot}>
                    <h3>{label}</h3>
                    {initial
                      .filter((e) => e.meal_date === day && e.slot === slot)
                      .map((e) => (
                        <article className="planned-meal" key={e.id}>
                          <label className="meal-selection">
                            <input
                              type="checkbox"
                              aria-label={"Označiť " + name(e)}
                              checked={selected.includes(e.id)}
                              onChange={(event) =>
                                setSelected((p) =>
                                  event.target.checked
                                    ? [...p, e.id]
                                    : p.filter((id) => id !== e.id),
                                )
                              }
                            />
                          </label>
                          <div className="meal-summary">
                            {recipe(e.recipe_version_id)?.photo && (
                              <Image
                                unoptimized
                                src={recipe(e.recipe_version_id)!.photo!}
                                alt=""
                                width={52}
                                height={52}
                              />
                            )}
                            <div>
                              <Link
                                href={
                                  "/meal-plan/recipe/" + e.recipe_version_id
                                }
                              >
                                <strong>
                                  {recipe(e.recipe_version_id)?.name ??
                                    "Recept"}
                                </strong>
                              </Link>
                              {(e.components ?? []).length > 0 && (
                                <p className="meal-sides">
                                  +{" "}
                                  {(e.components ?? [])
                                    .map(
                                      (c) => recipe(c.recipe_version_id)?.name,
                                    )
                                    .join(" + ")}
                                </p>
                              )}
                              <p>
                                {e.portions} porcie · {sourceLabel(e)}
                              </p>
                              {!eligibleMain(
                                recipe(e.recipe_version_id)!,
                                slot,
                              ) && (
                                <p className="meal-warning">
                                  Skontrolovať rolu: nie je potvrdené samostatné
                                  jedlo.
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="meal-actions">
                            <button disabled={!ready} onClick={() => open(e)}>
                              Vymeniť
                            </button>
                            <details>
                              <summary aria-label={"Ďalšie akcie " + name(e)}>
                                •••
                              </summary>
                              <div>
                                <button onClick={() => open(e)}>
                                  Upraviť porcie / presunúť
                                </button>
                                <button onClick={() => open(e)}>
                                  Vymeniť prílohu
                                </button>
                                <button
                                  onClick={() =>
                                    open({
                                      ...e,
                                      id: uuid(),
                                      revision: undefined,
                                      planned_batch_id: null,
                                      ready_portions: 0,
                                      components: e.components?.map((c) => ({
                                        ...c,
                                        planned_batch_id: null,
                                        ready_portions: 0,
                                      })),
                                    })
                                  }
                                >
                                  Kopírovať jedlo
                                </button>
                                <button
                                  disabled={!ready || linked.includes(e.id)}
                                  onClick={() => {
                                    setPreview({
                                      changes: [{ ...e, remove: true }],
                                      batches: [],
                                      warnings: [],
                                    });
                                    setConfirmed(false);
                                  }}
                                >
                                  Odstrániť po potvrdení
                                </button>
                                {linked.includes(e.id) && (
                                  <small>
                                    Napojený nákup zostane zachovaný; recept
                                    môžete vymeniť.
                                  </small>
                                )}
                              </div>
                            </details>
                          </div>
                        </article>
                      ))}
                    <button
                      className="slot-add"
                      disabled={!ready || !latest.length}
                      onClick={() =>
                        open({
                          id: uuid(),
                          recipe_version_id:
                            latest.find((r) => eligibleMain(r, slot))?.id ??
                            latest[0].id,
                          meal_date: day,
                          slot: slot as Meal["slot"],
                          portions: persons,
                          components: [],
                        })
                      }
                    >
                      + Pridať
                    </button>
                  </section>
                ))}
            </div>
          </article>
        ))}
      </div>
      {batches.filter((b) =>
        initial.some(
          (e) =>
            e.planned_batch_id === b.id ||
            e.components?.some((c) => c.planned_batch_id === b.id),
        ),
      ).length > 0 && (
        <section className="card">
          <h2>Plánované várky</h2>
          {batches
            .filter((b) =>
              initial.some(
                (e) =>
                  e.planned_batch_id === b.id ||
                  e.components?.some((c) => c.planned_batch_id === b.id),
              ),
            )
            .map((b) => (
              <p key={b.id}>
                <strong>{recipe(b.recipe_version_id)?.name}</strong> · uvariť{" "}
                {date(b.cooking_date)} · {b.portions} porcií · v tomto týždni{" "}
                {batchUsage(b.id, initial)} · možný zvyšok{" "}
                {Math.max(0, b.portions - batchUsage(b.id, initial))}{" "}
                <small>
                  (pred potvrdením zamrazenia skontrolujte aj iné týždne)
                </small>
              </p>
            ))}
          <p>
            Návrh várok nie je skutočná zásoba. Suroviny treba overiť v nákupnom
            zozname.
          </p>
        </section>
      )}
      {preview && (
        <div className="planner-overlay">
          <section
            className="planner-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Náhľad zmien"
          >
            <h2>Skontrolujte zmeny</h2>
            <p role="alert">{error}</p>
            {preview.changes.length === 0 && (
              <p>Nie sú žiadne zmeny. Obsadené sloty zostávajú zachované.</p>
            )}
            {preview.changes.map((e) => (
              <div className="preview-change" key={e.id}>
                <strong>
                  {date(e.meal_date)} · {slots[e.slot]}
                </strong>
                <p>
                  {e.remove
                    ? "Odstrániť: "
                    : initial.some((old) => old.id === e.id)
                      ? "Nahradiť: "
                      : "Pridať: "}
                  {name(e)} · {e.portions} porcie
                </p>
                {initial.find((old) => old.id === e.id) && !e.remove && (
                  <small>
                    Pôvodne: {name(initial.find((old) => old.id === e.id)!)}
                  </small>
                )}
                {linked.includes(e.id) && (
                  <p className="meal-warning">
                    Napojený nákup ostane nezmenený a bude označený na kontrolu.
                    {e.remove ? " Tento záznam nemožno odstrániť." : ""}
                  </p>
                )}
              </div>
            ))}
            {preview.batches.map((b) => (
              <p key={b.id}>
                Uvariť várku {date(b.cooking_date)}:{" "}
                {recipe(b.recipe_version_id)?.name}, {b.portions} porcií;
                naplánované {batchUsage(b.id, preview.changes)}, potenciálne
                zamraziť{" "}
                {Math.max(0, b.portions - batchUsage(b.id, preview.changes))}.
              </p>
            ))}
            {preview.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            <p>
              Plánovanie nemení zásoby. Nákup započíta celú novú várku iba raz.
            </p>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Potvrdzujem uvedené zmeny vrátane náhrad a odstránení.
            </label>
            <div className="planner-toolbar">
              <button onClick={() => setPreview(null)}>Zrušiť</button>
              <button
                disabled={
                  busy ||
                  !confirmed ||
                  !preview.changes.length ||
                  preview.changes.some((e) => e.remove && linked.includes(e.id))
                }
                onClick={() =>
                  save(preview.changes, preview.batches, generating)
                }
              >
                Potvrdiť zmeny
              </button>
            </div>
          </section>
        </div>
      )}
      {edit && (
        <div className="planner-overlay">
          <section
            className="planner-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Upraviť jedlo"
          >
            <h2>Jedlo a jeho prílohy</h2>
            <p>
              Pôvodne:{" "}
              {initial.find((e) => e.id === edit.id)
                ? name(initial.find((e) => e.id === edit.id)!)
                : "Nové jedlo"}
            </p>
            <div className="planner-fields">
              <label>
                Dátum
                <input
                  type="date"
                  value={edit.meal_date}
                  onChange={(e) =>
                    setEdit({ ...edit, meal_date: e.target.value })
                  }
                />
              </label>
              <label>
                Typ jedla
                <select
                  value={edit.slot}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      slot: e.target.value as Meal["slot"],
                      components: [],
                    })
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
                Počet porcií
                <input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={edit.portions}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      portions: Number(e.target.value),
                      components: edit.components?.map((c) => ({
                        ...c,
                        portions: Number(e.target.value),
                        ready_portions: 0,
                      })),
                      ready_portions: 0,
                    })
                  }
                />
              </label>
            </div>
            <label>
              Vyhľadať recept
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label>
              <input
                type="checkbox"
                checked={manual}
                onChange={(e) => setManual(e.target.checked)}
              />
              Manuálny výber aj nezatriedených receptov (mimo automatického
              návrhu)
            </label>
            <label>
              Hlavné jedlo
              <select
                aria-label="Hlavné jedlo"
                value={edit.recipe_version_id}
                onChange={(e) => {
                  const next = recipe(e.target.value)!;
                  setEdit({
                    ...edit,
                    recipe_version_id: next.id,
                    planned_batch_id: null,
                    ready_portions: 0,
                    components: edit.components?.filter((c) =>
                      compatibleSides(next, recipes, edit.slot).some(
                        (s) => s.id === c.recipe_version_id,
                      ),
                    ),
                  });
                }}
              >
                {[
                  ...latest,
                  ...recipes.filter(
                    (r) =>
                      r.id === edit.recipe_version_id &&
                      !latest.some((l) => l.id === r.id),
                  ),
                ]
                  .filter(
                    (r) =>
                      r.id === edit.recipe_version_id ||
                      ((manual || eligibleMain(r, edit.slot)) &&
                        r.name
                          .toLocaleLowerCase()
                          .includes(query.toLocaleLowerCase())),
                  )
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              Výsledok: <strong>{name(edit)}</strong> · {edit.portions} porcie
            </p>
            <fieldset>
              <legend>Vymeniť prílohu — hlavné jedlo zostáva</legend>
              {compatibleSides(
                recipe(edit.recipe_version_id)!,
                latest,
                edit.slot,
              ).map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={
                      edit.components?.some(
                        (c) => c.recipe_version_id === s.id,
                      ) ?? false
                    }
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        components: e.target.checked
                          ? [
                              ...(edit.components ?? []),
                              {
                                recipe_version_id: s.id,
                                portions: edit.portions,
                                ready_portions: 0,
                              },
                            ]
                          : edit.components?.filter(
                              (c) => c.recipe_version_id !== s.id,
                            ),
                      })
                    }
                  />
                  {s.name}
                </label>
              ))}
              {!compatibleSides(
                recipe(edit.recipe_version_id)!,
                latest,
                edit.slot,
              ).length && (
                <p>
                  Žiadne potvrdené prílohy.{" "}
                  <Link href="/meal-plan/roles">Nastaviť kompatibilitu</Link>
                </p>
              )}
            </fieldset>
            <label>
              Hotové porcie z mrazničky (známe:{" "}
              {available[recipe(edit.recipe_version_id)!.recipe_id] ??
                "neznáme"}
              )
              <input
                type="number"
                min="0"
                max={Math.min(
                  edit.portions,
                  available[recipe(edit.recipe_version_id)!.recipe_id] ?? 0,
                )}
                step="0.01"
                value={edit.ready_portions ?? 0}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    ready_portions: Number(e.target.value),
                    planned_batch_id: null,
                  })
                }
              />
            </label>
            <label>
              Existujúca plánovaná várka
              <select
                value={edit.planned_batch_id ?? ""}
                onChange={(e) => {
                  setEdit({
                    ...edit,
                    planned_batch_id: e.target.value || null,
                    ready_portions: 0,
                  });
                  setUseBatch(false);
                }}
              >
                <option value="">Bez priradenia</option>
                {batches
                  .filter(
                    (b) =>
                      b.recipe_version_id === edit.recipe_version_id &&
                      b.cooking_date <= edit.meal_date,
                  )
                  .map((b) => (
                    <option value={b.id} key={b.id}>
                      {date(b.cooking_date)} · {b.portions} porcií
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={useBatch}
                onChange={(e) => setUseBatch(e.target.checked)}
              />
              Uvariť novú várku
            </label>
            {useBatch && (
              <div className="planner-fields">
                <label>
                  Deň varenia
                  <input
                    type="date"
                    max={edit.meal_date}
                    value={cookDate}
                    onChange={(e) => setCookDate(e.target.value)}
                  />
                </label>
                <label>
                  Uvariť porcií
                  <input
                    type="number"
                    min={edit.portions}
                    max="100"
                    value={cookYield}
                    onChange={(e) => setCookYield(Number(e.target.value))}
                  />
                </label>
              </div>
            )}
            <p>
              Pri zmene receptu sa nákupný doklad nemení. Nový nákup sa
              prepočíta zo všetkých hlavných jedál, príloh a výťažkov várok.
              Manuálne položky zostanú zachované pri jeho následnej kontrole.
            </p>
            <details>
              <summary>Dopad na suroviny (pomerná potreba tohto jedla)</summary>
              <p>
                Pôvodné:{" "}
                {(() => {
                  const old = initial.find((e) => e.id === edit.id);
                  return old ? ingredientText(old, recipes) : "—";
                })()}
              </p>
              <p>Nové: {ingredientText(edit, recipes)}</p>
              <p>Cena zostáva neznáma, ak chýbajú spoľahlivé ceny surovín.</p>
            </details>
            <p role="alert">{error}</p>
            <div className="planner-toolbar">
              <button onClick={() => setEdit(null)}>Zrušiť</button>
              <button disabled={busy || !ready} onClick={editSave}>
                Potvrdiť výmenu a uložiť
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
function ingredientText(e: Meal, recipes: PlanningRecipe[]) {
  return [e, ...(e.components ?? [])]
    .flatMap((p) => {
      const r = recipes.find((r) => r.id === p.recipe_version_id);
      return r
        ? r.ingredients.map(
            (i) =>
              `${i.name}: ${Math.round(((i.quantity * p.portions) / r.portions) * 100) / 100} ${i.unit}`,
          )
        : [];
    })
    .join(", ");
}
