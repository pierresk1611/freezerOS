"use client";
import { useState } from "react";
import defaultSeed from "../../../../../docs/seed-recipes.json";
import Link from "next/link";
import {
  normalizeFiles,
  type ImportFile,
  type ImportRow,
  type ImportResult,
} from "@/lib/recipe-import";
type Choice = {
  selected: boolean;
  mode: "new" | "version";
  target: string | null;
  confirmed: boolean;
};
export function ImportBrowser() {
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [files, setFiles] = useState<ImportFile[]>([]),
    [rows, setRows] = useState<ImportRow[]>([]),
    [choices, setChoices] = useState<Record<string, Choice>>({}),
    [text, setText] = useState(""),
    [errors, setErrors] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [available, setAvailable] = useState(false),
    [results, setResults] = useState<ImportResult[] | null>(null),
    [progress, setProgress] = useState("");
  async function api(body: object) {
    const r = await fetch("/api/recipes/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({
      error:
        "Server nevrátil výsledok. Znovu načítajte náhľad; už uložené položky sa nezduplikujú.",
    }));
    if (!r.ok) throw new Error(j.error);
    return j;
  }
  async function preview(next: ImportFile[], issues: string[] = fileErrors) {
    setBusy(true);
    setResults(null);
    setErrors(issues);
    setFileErrors(issues);
    try {
      const j = await api({ action: "preview", files: next });
      setFiles(next);
      setRows(j.rows);
      setAvailable(j.available);
      setChoices(
        Object.fromEntries(
          j.rows.map((r: ImportRow) => [
            r.key,
            {
              selected:
                !r.error && !r.already && !r.duplicates.length && !r.within,
              mode: "new",
              target: null,
              confirmed: false,
            },
          ]),
        ),
      );
    } catch (e) {
      setErrors([...issues, (e as Error).message]);
      setRows([]);
      setFiles([]);
    } finally {
      setBusy(false);
    }
  }
  async function load(input: FileList | null) {
    if (!input?.length) return;
    setBusy(true);
    setErrors([]);
    const next: ImportFile[] = [],
      issues: string[] = [];
    try {
      if (input.length > 10)
        throw new Error("Vyberte najviac 10 JSON súborov.");
      if (Array.from(input).reduce((s, f) => s + f.size, 0) > 2000000)
        throw new Error("Súbory spolu môžu mať najviac 2 MB.");
      for (const file of Array.from(input)) {
        try {
          const data = JSON.parse(await file.text());
          next.push(...normalizeFiles([{ name: file.name, data }]));
        } catch (e) {
          issues.push(
            `${file.name}: ${e instanceof SyntaxError ? "JSON sa nedá prečítať." : (e as Error).message}`,
          );
        }
      }
      if (next.length) await preview(normalizeFiles(next), issues);
      else {
        setFiles([]);
        setRows([]);
        setResults(null);
        setErrors(issues);
      }
    } catch (e) {
      setErrors([(e as Error).message]);
      setRows([]);
      setFiles([]);
      setChoices({});
      setResults(null);
    } finally {
      setBusy(false);
    }
  }
  function choose(key: string, patch: Partial<Choice>) {
    setChoices((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
  }
  async function apply() {
    setBusy(true);
    setErrors(fileErrors);
    setResults(null);
    const result: ImportResult[] = rows
      .filter((r) => !choices[r.key]?.selected)
      .map((r) => ({
        key: r.key,
        name: r.name,
        status: r.error
          ? "error"
          : r.already
            ? "skipped"
            : r.duplicates.length || r.within
              ? "duplicate"
              : "skipped",
        recipeId: r.already
          ? r.duplicates.find((v) => !v.archived)?.recipe_id
          : null,
        reason:
          r.error ??
          (r.already
            ? "Tento recept z rovnakého súboru už bol spracovaný."
            : "Nevybrané na import."),
      }));
    try {
      const selected = rows.filter(
        (r) => choices[r.key]?.selected && !r.error && !r.already,
      );
      for (let i = 0; i < selected.length; i += 20) {
        setProgress(
          `Spracúvam ${i + 1}–${Math.min(i + 20, selected.length)} z ${selected.length}`,
        );
        const j = await api({
          action: "apply",
          files,
          choices: selected.slice(i, i + 20).map((r) => ({
            key: r.key,
            file: r.file,
            index: r.index,
            mode: choices[r.key].mode,
            target: choices[r.key].target,
            confirmed: choices[r.key].confirmed,
          })),
        });
        result.push(...j.results);
        setResults([...result]);
      }
      setResults(result);
    } catch (e) {
      setErrors([
        (e as Error).message,
        "Import bol prerušený. Obnovte náhľad na overenie skutočne uložených položiek; už uložené recepty sa nepridajú druhýkrát.",
      ]);
      for (const row of rows.filter(
        (r) => choices[r.key]?.selected && !result.some((x) => x.key === r.key),
      )) {
        result.push({
          key: row.key,
          name: row.name,
          status: "error",
          reason:
            "Server nepotvrdil výsledok. Obnovte stav importu pred ďalším pokusom.",
        });
      }
      setResults(result);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  const selected = rows.filter(
    (r) => choices[r.key]?.selected && !r.error && !r.already,
  );
  const unsafe = selected.some(
    (r) =>
      choices[r.key].mode === "version" &&
      (!choices[r.key].confirmed || !choices[r.key].target),
  );
  return (
    <div className="batch-import">
      <div
        className="import-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) void load(e.dataTransfer.files);
        }}
      >
        <h2>Recepty z JSON súborov</h2>
        <p>
          Vyberte jeden alebo viac súborov. Na počítači ich môžete pretiahnuť
          sem. Najviac 10 súborov, 200 receptov a 2 MB spolu.
        </p>
        <label htmlFor="import-files">Vybrať JSON súbory</label>
        <input
          id="import-files"
          type="file"
          multiple
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            void load(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <button
        type="button"
        className="button-secondary"
        disabled={busy}
        onClick={() =>
          void preview(
            normalizeFiles([{ name: "seed-recipes.json", data: defaultSeed }]),
            [],
          )
        }
      >
        Zobraziť 15 predvolených šablón v náhľade
      </button>
      <details>
        <summary>Vložiť JSON zo schránky</summary>
        <label htmlFor="import-json">JSON obálka FREEZER OS 1.0</label>
        <textarea
          id="import-json"
          value={text}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            setRows([]);
            setFiles([]);
            setChoices({});
            setResults(null);
          }}
        />
        <button
          className="button-secondary"
          disabled={busy || !text.trim()}
          onClick={() => {
            try {
              if (new TextEncoder().encode(text).length > 2000000)
                throw new Error("JSON môže mať najviac 2 MB.");
              void preview(
                normalizeFiles([
                  { name: "Zo schránky.json", data: JSON.parse(text) },
                ]),
                [],
              );
            } catch (e) {
              setRows([]);
              setFiles([]);
              setChoices({});
              setResults(null);
              setErrors([
                e instanceof SyntaxError
                  ? "JSON sa nedá prečítať."
                  : (e as Error).message,
              ]);
            }
          }}
        >
          Skontrolovať a zobraziť náhľad
        </button>
      </details>
      {errors.map((e, i) => (
        <p key={i} role="alert" className="error">
          {e}
        </p>
      ))}
      {busy && (
        <p role="status">{progress || "Načítavam a kontrolujem recepty…"}</p>
      )}
      {rows.length > 0 && (
        <>
          <h2>Náhľad všetkých {rows.length} receptov</h2>
          <p>
            Možné duplicity sa predvolene preskočia. Kontrolujeme názov aj obsah
            vrátane historických verzií a archivovaných receptov. Nová verzia
            vyžaduje váš výslovný súhlas.
          </p>
          {!available && (
            <p role="alert">
              Pred potvrdením treba aktivovať migráciu 008. Náhľad nič
              nezapisuje.
            </p>
          )}
          <div className="photo-actions">
            <button
              className="button-secondary"
              disabled={busy}
              onClick={() =>
                setChoices((c) =>
                  Object.fromEntries(
                    rows.map((r) => [
                      r.key,
                      {
                        ...c[r.key],
                        selected:
                          !r.error &&
                          !r.already &&
                          !r.duplicates.length &&
                          !r.within,
                      },
                    ]),
                  ),
                )
              }
            >
              Vybrať iba nové
            </button>
            <button
              className="button-secondary"
              disabled={busy}
              onClick={() =>
                setChoices((c) =>
                  Object.fromEntries(
                    Object.entries(c).map(([k, v]) => [
                      k,
                      { ...v, selected: false },
                    ]),
                  ),
                )
              }
            >
              Zrušiť výber
            </button>
            <button
              className="button-secondary"
              disabled={busy}
              onClick={() => void preview(files)}
            >
              Obnoviť stav importu
            </button>
          </div>
          <div className="import-preview">
            {rows.map((r) => {
              const c = choices[r.key];
              return (
                <article
                  key={r.key}
                  className={`card import-row ${r.error ? "invalid" : r.already || r.duplicates.length || r.within ? "possible-duplicate" : ""}`}
                >
                  <label className="import-select">
                    <input
                      type="checkbox"
                      aria-label={`Vybrať ${r.name}`}
                      checked={c?.selected ?? false}
                      disabled={busy || !!r.error || r.already}
                      onChange={(e) =>
                        choose(r.key, { selected: e.target.checked })
                      }
                    />
                    <strong>{r.name}</strong>
                  </label>
                  <p>
                    {files[r.file]?.name} · recept {r.index + 1} ·{" "}
                    {r.recipe?.portions ?? "?"} porcií
                  </p>
                  {r.error && <p className="error">{r.error}</p>}
                  {r.already && (
                    <p>
                      Už spracované — opakované nahratie nevytvorí recept ani
                      novú verziu.
                    </p>
                  )}
                  {!r.already && r.within && (
                    <p>Možná duplicita medzi nahranými receptami.</p>
                  )}
                  {!r.already && r.duplicates.length > 0 && (
                    <>
                      <p>Možná duplicita v kuchárke:</p>
                      <ul>
                        {r.duplicates.map((v) => (
                          <li key={v.id}>
                            {v.archived ? (
                              <span>{v.name} (archivované)</span>
                            ) : (
                              <Link
                                href={`/recipes/${v.recipe_id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {v.name} · verzia {v.version}
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                      <label>
                        Spracovanie duplicity
                        <select
                          aria-label={`Spracovanie ${r.name}`}
                          disabled={busy}
                          value={c.mode}
                          onChange={(e) =>
                            choose(r.key, {
                              mode: e.target.value as Choice["mode"],
                              selected: e.target.value === "version",
                              target:
                                r.duplicates.find((v) => !v.archived)?.id ??
                                null,
                              confirmed: false,
                            })
                          }
                        >
                          <option value="new">
                            Bezpečne preskočiť existujúci recept
                          </option>
                          <option value="version">
                            Vytvoriť novú verziu existujúceho receptu
                          </option>
                        </select>
                      </label>
                      {c.mode === "version" && (
                        <>
                          <label>
                            Cieľový recept
                            <select
                              aria-label={`Cieľ ${r.name}`}
                              disabled={busy}
                              value={c.target ?? ""}
                              onChange={(e) =>
                                choose(r.key, {
                                  target: e.target.value || null,
                                  confirmed: false,
                                })
                              }
                            >
                              <option value="">Vyberte aktívny recept</option>
                              {r.duplicates
                                .filter((v) => !v.archived)
                                .map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name} · aktuálna verzia {v.version}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="import-select">
                            <input
                              aria-label={`Potvrdiť novú verziu ${r.name}`}
                              type="checkbox"
                              checked={c.confirmed}
                              disabled={busy || !c.target}
                              onChange={(e) =>
                                choose(r.key, { confirmed: e.target.checked })
                              }
                            />
                            Potvrdzujem novú verziu vybraného receptu. Jeho
                            aktuálny text nahradí importovaný obsah; staršie
                            verzie a várky zostanú zachované.
                          </label>
                        </>
                      )}
                    </>
                  )}
                  {r.recipe && (
                    <details>
                      <summary>Suroviny a úplný obsah</summary>
                      <ul>
                        {r.recipe.ingredients.map((i, n) => (
                          <li key={n}>
                            {i.quantity} {i.unit} {i.name}
                          </li>
                        ))}
                      </ul>
                      <ol>
                        {r.recipe.steps.map((s, n) => (
                          <li key={n}>{s}</li>
                        ))}
                      </ol>
                      <p>Skladovanie: {r.recipe.storage}</p>
                      <p>Zohrievanie: {r.recipe.reheating}</p>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
          <div className="import-confirm">
            <p>
              Vybrané: {selected.length}. Žiadna zásoba ani historická várka sa
              importom nemení.
            </p>
            <button
              disabled={busy || (selected.length > 0 && !available) || unsafe}
              onClick={() => void apply()}
            >
              Importovať vybrané recepty
            </button>
          </div>
        </>
      )}
      {results && (
        <section className="card" aria-label="Výsledok importu">
          <h2>Výsledok importu</h2>
          <p>
            Pridané: {results.filter((r) => r.status === "added").length} · Nové
            verzie: {results.filter((r) => r.status === "version").length} ·
            Preskočené: {results.filter((r) => r.status === "skipped").length} ·
            Duplicitné: {results.filter((r) => r.status === "duplicate").length}{" "}
            · Chybné:{" "}
            {results.filter((r) => r.status === "error").length +
              fileErrors.length}
          </p>
          <ul>
            {results.map((r) => (
              <li key={r.key}>
                {r.name}:{" "}
                {
                  {
                    added: "pridané",
                    version: "nová verzia",
                    skipped: "preskočené",
                    duplicate: "duplicita",
                    error: "chyba",
                  }[r.status]
                }
                {r.reason ? ` — ${r.reason}` : ""}
                {r.recipeId && (
                  <Link href={`/recipes/${r.recipeId}`}> · Otvoriť recept</Link>
                )}
              </li>
            ))}
          </ul>
          <Link
            className="button"
            href={
              results.some((r) => r.recipeId)
                ? "/recipes?ids=" +
                  Array.from(
                    new Set(
                      results.filter((r) => r.recipeId).map((r) => r.recipeId),
                    ),
                  ).join(",")
                : "/recipes"
            }
          >
            Zobraziť importované recepty
          </Link>
          <button
            className="button-secondary"
            disabled={busy}
            onClick={() => void preview(files)}
          >
            Znovu overiť rovnaké súbory
          </button>
        </section>
      )}
    </div>
  );
}
