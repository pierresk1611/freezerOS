"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cubeOperation } from "./actions";
import { balanceCubes, allocateCosts } from "@/lib/portioning";
import { money } from "@/lib/domain";
export type Mold = {
  id: string;
  name: string;
  cells: number;
  cell_ml: number;
  owned_count: number;
};
type Cube = {
  cube_index: number;
  weight_g: number;
  volume_ml: number;
  mold_id: string;
};
async function run(kind: string, request: string, payload: unknown) {
  const f = new FormData();
  f.set("kind", kind);
  f.set("request", request);
  f.set("payload", JSON.stringify(payload));
  return cubeOperation(f);
}
export function CubeBatchEditor({
  recipes,
  molds,
  request,
  today,
  selected,
}: {
  recipes: { id: string; name: string }[];
  molds: Mold[];
  request: string;
  today: string;
  selected?: string;
}) {
  const router = useRouter();
  const [cubes, setCubes] = useState([
    { mold_id: molds[0]?.id ?? "", weight_g: 0, volume_ml: 0 },
  ]);
  const [weight, setWeight] = useState(0),
    [version, setVersion] = useState(selected ?? recipes[0]?.id ?? "");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const balance = balanceCubes(cubes, weight);
  return (
    <form
      className="recipe-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!balance.valid) {
          setMessage(
            "Súčet hmotností kociek sa musí rovnať skutočnému výťažku.",
          );
          return;
        }
        const element = e.currentTarget;
        const data = new FormData(element);
        setBusy(true);
        try {
          const result = await run("start", request, {
            version,
            weight,
            cost: String(data.get("cost")),
            made: String(data.get("made")),
            quality: String(data.get("quality")),
            cubes,
          });
          if (result.destination) {
            setWeight(0);
            setCubes([
              { mold_id: molds[0]?.id ?? "", weight_g: 0, volume_ml: 0 },
            ]);
            element.reset();
            router.push(result.destination);
            router.refresh();
          } else setMessage(result.message ?? "Uloženie zlyhalo.");
        } catch {
          setMessage("Spojenie sa prerušilo. Skúste znova.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <section className="card">
        <h2>1. Skutočný výťažok</h2>
        <label>
          Recept
          <select
            disabled={busy}
            aria-label="Recept"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          >
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hmotnosť porciovaného jedla (g)
          <input
            disabled={busy}
            type="number"
            required
            min={1}
            max={1000000}
            value={weight || ""}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </label>
        <label>
          Skutočné náklady porciovaného obsahu (Kč)
          <input
            disabled={busy}
            name="cost"
            inputMode="decimal"
            placeholder="Neznáme"
          />
        </label>
        <p>
          Ak prílohy balíte zvlášť, nezapočítavajte ich hmotnosť ani náklady do
          tejto várky.
        </p>
        <label>
          Dátum výroby
          <input
            disabled={busy}
            type="date"
            name="made"
            defaultValue={today}
            required
          />
        </label>
        <label>
          Orientačný dátum zachovania kvality
          <input disabled={busy} type="date" name="quality" required />
        </label>
      </section>
      <section>
        <h2>2. Kocky a formy</h2>
        <p>
          Objem a hmotnosť zadávajte samostatne. 250 ml nie je automaticky 250
          g.
        </p>
        <div className="cube-grid">
          {cubes.map((c, i) => (
            <article className="card" key={i}>
              <h3>Kocka {i + 1}</h3>
              <label>
                Forma kocky {i + 1}
                <select
                  disabled={busy}
                  aria-label={`Forma kocky ${i + 1}`}
                  value={c.mold_id}
                  required
                  onChange={(e) =>
                    setCubes(
                      cubes.map((x, n) =>
                        n === i
                          ? { ...x, mold_id: e.target.value, volume_ml: 0 }
                          : x,
                      ),
                    )
                  }
                >
                  {molds.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name} · {m.cell_ml} ml
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hmotnosť kocky {i + 1} (g)
                <input
                  disabled={busy}
                  required
                  type="number"
                  min={1}
                  max={1000000}
                  value={c.weight_g || ""}
                  onChange={(e) =>
                    setCubes(
                      cubes.map((x, n) =>
                        n === i
                          ? { ...x, weight_g: Number(e.target.value) }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Objem kocky {i + 1} (ml)
                <input
                  disabled={busy}
                  required
                  type="number"
                  min={1}
                  max={molds.find((m) => m.id === c.mold_id)?.cell_ml}
                  value={c.volume_ml || ""}
                  onChange={(e) =>
                    setCubes(
                      cubes.map((x, n) =>
                        n === i
                          ? { ...x, volume_ml: Number(e.target.value) }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              {molds.find((m) => m.id === c.mold_id)?.cell_ml === 250 && (
                <button
                  type="button"
                  onClick={() =>
                    setCubes(
                      cubes.map((x, n) =>
                        n === i ? { ...x, volume_ml: 125 } : x,
                      ),
                    )
                  }
                >
                  Naplnené na 125 ml
                </button>
              )}
              <button
                type="button"
                disabled={cubes.length === 1 || busy}
                onClick={() => setCubes(cubes.filter((_, n) => n !== i))}
              >
                Odstrániť kocku {i + 1}
              </button>
            </article>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || cubes.length >= 200}
          onClick={() =>
            setCubes([
              ...cubes,
              { mold_id: molds[0]?.id ?? "", weight_g: 0, volume_ml: 0 },
            ])
          }
        >
          Pridať kocku
        </button>
      </section>
      <section className="card" aria-live="polite">
        <h2>Bilancia</h2>
        <p>
          {cubes.length} kociek · {balance.grams} / {weight} g · {balance.ml} ml
        </p>
        <p>
          {balance.valid
            ? "Hmotnosť súhlasí."
            : "Doplňte skutočné hmotnosti celej várky."}
        </p>
        <p>
          Rýchlo schlaďte, potom zmrazte približne pri −18 °C. Tekutý obsah
          vákuujte až po úplnom zmrazení. Dátum kvality nie je bezpečnostnou
          zárukou.
        </p>
        {message && <p role="alert">{message}</p>}
        <button disabled={busy || !molds.length || !recipes.length}>
          {busy ? "Ukladám…" : "Uložiť várku a kocky na zmrazenie"}
        </button>
      </section>
    </form>
  );
}
export function VacuumEditor({
  batch,
  cubes,
  locations,
  request,
  today,
}: {
  batch: {
    id: string;
    portion_status: string;
    weight_g: number;
    cost_minor: number | null;
    manufactured_on: string;
  };
  cubes: Cube[];
  locations: { id: string; name: string }[];
  request: string;
  today: string;
}) {
  const router = useRouter();
  const [bags, setBags] = useState(Math.min(3, Math.max(1, cubes.length))),
    [assign, setAssign] = useState<Record<number, number>>(() =>
      Object.fromEntries(
        cubes.map((c, i) => [
          c.cube_index,
          i % Math.min(3, Math.max(1, cubes.length)),
        ]),
      ),
    ),
    [portions, setPortions] = useState<Record<number, number>>({}),
    [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const groups = Array.from({ length: bags }, (_, i) => ({
    cubes: cubes
      .filter((c) => assign[c.cube_index] === i)
      .map((c) => c.cube_index),
    portions: portions[i] ?? 1,
    location_id: location || null,
  })).filter((g) => g.cubes.length);
  const weights = groups.map((g) =>
    cubes
      .filter((c) => g.cubes.includes(c.cube_index))
      .reduce((s, c) => s + c.weight_g, 0),
  );
  const costs = allocateCosts(batch.cost_minor, weights);
  async function submit(kind: string, payload: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const r = await run(kind, request, payload);
      if (r.destination) {
        router.push(r.destination);
        router.refresh();
      } else setMessage(r.message ?? "Operácia zlyhala.");
    } catch {
      setMessage("Spojenie sa prerušilo. Skúste znova.");
    } finally {
      setBusy(false);
    }
  }
  if (batch.portion_status === "cooling")
    return (
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit("freeze", {
            batch: batch.id,
            frozen: new FormData(e.currentTarget).get("frozen"),
          });
        }}
      >
        <h3>Potvrdiť úplné zmrazenie</h3>
        <p>
          {cubes.length} kociek · {batch.weight_g} g. Kocky zatiaľ nie sú
          skladové balíčky.
        </p>
        <label>
          Dátum zmrazenia
          <input
            disabled={busy}
            type="date"
            name="frozen"
            min={batch.manufactured_on}
            defaultValue={today}
            required
          />
        </label>
        {message && <p role="alert">{message}</p>}
        <button disabled={busy}>Kocky sú zmrazené</button>
      </form>
    );
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void submit("pack", { batch: batch.id, packages: groups });
      }}
    >
      <h3>Rozdeliť do vákuových balíčkov</h3>
      <label>
        Predpokladaný počet sáčkov
        <input
          disabled={busy}
          type="number"
          min={1}
          max={Math.max(1, cubes.length)}
          value={bags}
          onChange={(e) => {
            const n = Math.max(
              1,
              Math.min(cubes.length, Number(e.target.value)),
            );
            setBags(n);
            setAssign(
              Object.fromEntries(
                cubes.map((c) => [
                  c.cube_index,
                  (assign[c.cube_index] ?? 0) % n,
                ]),
              ),
            );
          }}
        />
      </label>
      <div className="cube-grid">
        {cubes.map((c) => (
          <label className="cube-choice" key={c.cube_index}>
            Kocka {c.cube_index + 1} · {c.weight_g} g / {c.volume_ml} ml
            <select
              disabled={busy}
              aria-label={`Balíček kocky ${c.cube_index + 1}`}
              value={assign[c.cube_index]}
              onChange={(e) =>
                setAssign({ ...assign, [c.cube_index]: Number(e.target.value) })
              }
            >
              {Array.from({ length: bags }, (_, i) => (
                <option value={i} key={i}>
                  Sáčok {i + 1}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <label>
        Umiestnenie v mrazničke
        <select
          disabled={busy}
          aria-label="Umiestnenie v mrazničke"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        >
          <option value="">Bez umiestnenia</option>
          {locations.map((l) => (
            <option value={l.id} key={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <h3>Náhľad: {groups.length} finálnych balíčkov</h3>
      {groups.map((g, i) => (
        <div className="package-preview" key={g.cubes.join(",")}>
          <strong>
            {weights[i]} g · {g.cubes.length} kociek · {money(costs[i])}
          </strong>
          <label>
            Porcie v balíčku {i + 1}
            <input
              disabled={busy}
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              value={g.portions}
              onChange={(e) => {
                const index = assign[g.cubes[0]];
                setPortions({ ...portions, [index]: Number(e.target.value) });
              }}
              required
            />
          </label>
        </div>
      ))}
      <p>
        Spolu {weights.reduce((a, b) => a + b, 0)} / {batch.weight_g} g ·{" "}
        {money(batch.cost_minor)}. Vákuovanie vytvorí skladový príjem iba raz.
      </p>
      {message && <p role="alert">{message}</p>}
      <button disabled={busy}>
        {busy ? "Ukladám…" : "Potvrdiť vákuovanie a príjem do mrazničky"}
      </button>
    </form>
  );
}
