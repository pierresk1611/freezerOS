"use client";
import { RecipeSections } from "@/components/recipe-sections";
import { useState } from "react";
import Link from "next/link";
import {
  parsePrep,
  prepError,
  prepPrompt,
  type PrepDocument,
} from "@/lib/meal-prep";
import { contentKey, normalizedText } from "@/lib/recipe-import";
import { shoppingRequirements, type PlanningRecipe } from "@/lib/planning";
import schema from "../../../../../docs/meal-prep-import.schema.json";
import "../meal-preps.css";
type Loaded = {
  file: string;
  doc: PrepDocument;
  keys: string[];
  reuse: Record<string, string>;
};
export default function Importer({
  existing,
  ready,
}: {
  existing: { id: string; name: string; key: string }[];
  ready: boolean;
}) {
  const [loaded, setLoaded] = useState<Loaded[]>([]),
    [text, setText] = useState(""),
    [message, setMessage] = useState(""),
    [fileErrors, setFileErrors] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [results, setResults] = useState<
      { file: string; id?: string; error?: string }[]
    >([]);
  function matches(r: PrepDocument["recipes"][number]) {
    const key = contentKey({
      ...r.recipe,
      meal_role: undefined,
      allowed_slots: undefined,
      side_policy: undefined,
      compatible_side_ids: undefined,
    });
    return existing.filter(
      (e) =>
        e.key === key ||
        normalizedText(e.name) === normalizedText(r.recipe.name),
    );
  }
  function load(raw: string, file: string) {
    try {
      const doc = parsePrep(JSON.parse(raw));
      const seen = new Set<string>();
      const reuse: Record<string, string> = {};
      const keys = doc.recipes
        .filter((r) => {
          const content = contentKey(r.recipe);
          if (seen.has(content)) return false;
          seen.add(content);
          const found = matches(r);
          const exact = found.find(
            (e) =>
              e.key ===
              contentKey({
                ...r.recipe,
                meal_role: undefined,
                allowed_slots: undefined,
                side_policy: undefined,
                compatible_side_ids: undefined,
              }),
          );
          if (exact) reuse[r.key] = exact.id;
          return !found.length || !!exact;
        })
        .map((r) => r.key);
      setLoaded((p) =>
        p.some((f) => f.doc.importId === doc.importId)
          ? p
          : [...p, { file, doc, keys, reuse }],
      );
    } catch (e) {
      setFileErrors((p) => [...p, file + ": " + prepError(e)]);
    }
  }
  async function files(list: FileList | File[]) {
    setMessage("");
    for (const f of Array.from(list).slice(0, 10)) {
      if (f.size > 3500000) {
        setFileErrors((p) => [...p, f.name + ": najviac 3,5 MB."]);
        continue;
      }
      load(await f.text(), f.name);
    }
  }
  async function submit() {
    setBusy(true);
    setResults([]);
    for (const item of loaded) {
      if (!item.keys.length) continue;
      try {
        const r = await fetch("/api/meal-preps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "import",
            document: item.doc,
            keys: item.keys,
            reuse: item.reuse,
          }),
        });
        const d = await r.json();
        setResults((p) => [
          ...p,
          { file: item.file, id: d.id, error: r.ok ? undefined : d.error },
        ]);
      } catch {
        setResults((p) => [
          ...p,
          {
            file: item.file,
            error:
              "Spojenie zlyhalo. Opakovaný import rovnakého súboru je bezpečný.",
          },
        ]);
      }
    }
    setBusy(false);
  }
  return (
    <section className="recipe-page prep-page">
      <RecipeSections active="projects" />
      <Link href="/meal-preps">← Meal prepy</Link>
      <h1>Import meal-prepu od AI</h1>
      <p>
        Jeden súbor uchová kompletné recepty, harmonogram a plán mrazenia.
        Import nevytvára zásoby ani výdavky.
      </p>
      {!ready && <p role="alert">Najprv aktivujte migráciu 011 po 010.</p>}
      <div className="prep-actions">
        <a href="/api/meal-preps/example" download>
          Stiahnuť vzorový JSON (3 recepty)
        </a>
        <a href="/api/meal-preps/schema" download>
          Oficiálna JSON schéma
        </a>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                prepPrompt + "\n\n" + JSON.stringify(schema),
              );
              setMessage("Zadanie aj schéma sú skopírované.");
            } catch {
              setMessage(
                "Kopírovanie nie je dostupné. Text zadania nájdete pod formulárom.",
              );
            }
          }}
        >
          Skopírovať zadanie pre ChatGPT
        </button>
      </div>
      <div
        className="card prep-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          files(e.dataTransfer.files);
        }}
      >
        <label>
          Vybrať JSON súbory
          <input
            type="file"
            multiple
            accept="application/json,.json"
            onChange={(e) => {
              if (e.target.files) files(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <p>
          Na počítači môžete súbory pretiahnuť sem. Každý súbor vytvorí
          samostatný projekt.
        </p>
      </div>
      <label>
        Vložiť JSON
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="{…}"
        />
      </label>
      <button
        disabled={!text.trim()}
        onClick={() => load(text, "Vložený JSON")}
      >
        Načítať náhľad
      </button>
      <p role="status" style={{ whiteSpace: "pre-wrap" }}>
        {message}
      </p>
      {fileErrors.length > 0 && (
        <p role="alert" style={{ whiteSpace: "pre-wrap" }}>
          {fileErrors.join("\n")}
        </p>
      )}
      {loaded.map((item, index) => {
        const selected = item.doc.recipes.filter((r) =>
          item.keys.includes(r.key),
        );
        const recipes = selected.map((r) => ({
          ...r.recipe,
          id: r.key,
          recipe_id: r.key,
        })) as PlanningRecipe[];
        const shopping = shoppingRequirements(
          selected.map((r) => ({
            id: r.key,
            recipe_version_id: r.key,
            portions: r.planned_portions,
            from_freezer: 0,
            meal_entry_id: null,
          })),
          recipes,
          [],
          item.doc.cooking_date,
        );
        return (
          <article className="card" key={item.doc.importId}>
            <h2>{item.doc.name}</h2>
            <p>
              {item.file} · {selected.length} / {item.doc.recipes.length}{" "}
              receptov · cieľ {item.doc.target_portions} hlavných porcií ·{" "}
              {item.doc.days} dní · varenie {item.doc.cooking_date}
            </p>
            <p>{item.doc.description}</p>
            {item.doc.recipes.map((r) => {
              const found = matches(r);
              return (
                <section className="prep-preview-recipe" key={r.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.keys.includes(r.key)}
                      onChange={(e) =>
                        setLoaded((p) =>
                          p.map((f, i) =>
                            i === index
                              ? {
                                  ...f,
                                  keys: e.target.checked
                                    ? [...f.keys, r.key]
                                    : f.keys.filter((k) => k !== r.key),
                                }
                              : f,
                          ),
                        )
                      }
                    />
                    <strong>{r.recipe.name}</strong> · {r.planned_portions}{" "}
                    porcií
                  </label>
                  {found.length > 0 && (
                    <label>
                      Možná duplicita — použiť existujúcu verziu (bez
                      prepísania)
                      <select
                        aria-label={"Existujúca verzia " + r.key}
                        value={item.reuse[r.key] ?? ""}
                        onChange={(e) =>
                          setLoaded((p) =>
                            p.map((f, i) =>
                              i === index
                                ? {
                                    ...f,
                                    reuse: {
                                      ...f.reuse,
                                      [r.key]: e.target.value,
                                    },
                                  }
                                : f,
                            ),
                          )
                        }
                      >
                        <option value="">
                          Vyberte existujúcu verziu alebo recept vynechajte
                        </option>
                        {found.map((e) => (
                          <option value={e.id} key={e.id}>
                            {e.name} · {e.id.slice(0, 8)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <p>
                    {r.recipe.ingredients.length} surovín ·{" "}
                    {r.recipe.steps.length} krokov · rola {r.recipe.meal_role}
                  </p>
                  <p>{r.preservation.cooling}</p>
                  <p>{r.preservation.freezing}</p>
                  <details>
                    <summary>Celý recept a porciovanie</summary>
                    <ul>
                      {r.recipe.ingredients.map((i, n) => (
                        <li key={n}>
                          {i.name}: {i.quantity} {i.unit}
                        </li>
                      ))}
                    </ul>
                    <ol>
                      {r.recipe.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                    <p>{r.portioning.description}</p>
                    <p>{r.preservation.vacuuming}</p>
                    <p>{r.preservation.thawing}</p>
                    <p>{r.recipe.reheating}</p>
                  </details>
                </section>
              );
            })}
            <h3>Spoločný nákup vybraných receptov</h3>
            <ul>
              {shopping.map((i) => (
                <li key={i.ingredient_key + i.unit}>
                  {i.name}: {i.required} {i.unit}
                </li>
              ))}
            </ul>
            <p>
              Domáce suroviny sa zohľadnia pri vytvorení nákupu v projekte.
              Neodpisujú sa.
            </p>
            <h3>Organizácia varenia</h3>
            <ol>
              {item.doc.timeline
                .filter((t) => t.recipe_keys.some((k) => item.keys.includes(k)))
                .map((t) => (
                  <li key={t.key}>
                    +{t.start_minute} min · {t.label} ({t.duration_minutes} min)
                  </li>
                ))}
            </ol>
            <button
              onClick={() => setLoaded((p) => p.filter((_, i) => i !== index))}
            >
              Odobrať súbor z náhľadu
            </button>
          </article>
        );
      })}
      {loaded.length > 0 && (
        <button
          disabled={
            !ready ||
            busy ||
            !loaded.some((f) => f.keys.length) ||
            loaded.some((f) =>
              f.keys.some(
                (k) =>
                  matches(f.doc.recipes.find((r) => r.key === k)!).length &&
                  !f.reuse[k],
              ),
            )
          }
          onClick={submit}
        >
          Importovať vybrané meal-prepy
        </button>
      )}
      {results.map((r, i) => (
        <p role={r.error ? "alert" : "status"} key={i}>
          {r.file}:{" "}
          {r.error ??
            "Projekt je uložený; opakovaný import nevytvorí duplicity."}{" "}
          {r.id && (
            <Link href={"/meal-preps/" + r.id}>Otvoriť meal prep →</Link>
          )}
        </p>
      ))}
      <details>
        <summary>Text zadania pre ChatGPT</summary>
        <p>{prepPrompt}</p>
      </details>
    </section>
  );
}
