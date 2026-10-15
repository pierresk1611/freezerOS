import Link from "next/link";
import { randomUUID } from "node:crypto";
import { userDb } from "@/lib/supabase";
import { addMold } from "./actions";
import { CubeBatchEditor, VacuumEditor } from "./editor";
export default async function Portioning({
  searchParams,
}: {
  searchParams: Promise<{ version?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { client } = await userDb();
  const results = await Promise.all([
    client.from("portion_molds").select("*"),
    client.from("recipe_latest").select("id,name").eq("freezing", true),
    client
      .from("cooking_batches")
      .select("*,recipe_versions(name)")
      .in("portion_status", ["cooling", "frozen"]),
    client.from("batch_cubes").select("*").is("package_id", null),
    client.from("storage_locations").select("id,name"),
  ]);
  if (results.some((r) => r.error))
    return (
      <section className="card">
        <h1>Formy a porciovanie</h1>
        <p>
          Aktivujte migráciu 005 v Supabase SQL Editore. Existujúce zásoby
          zostávajú dostupné.
        </p>
        <Link href="/inventory">Mraznička</Link>
      </section>
    );
  const [molds, recipes, batches, cubes, locations] = results.map(
    (r) => r.data ?? [],
  );
  if (params.version && !recipes.some((r) => r.id === params.version)) {
    const version = await client
      .from("recipe_versions")
      .select("id,name,freezing")
      .eq("id", params.version)
      .maybeSingle();
    if (version.data?.freezing) recipes.push(version.data);
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return (
    <div className="recipe-page">
      <h1>Formy a porciovanie</h1>
      <p>Od šťavnatého mäsa po samostatné vákuové balíčky.</p>
      {params.error && (
        <p role="alert">Formu sa nepodarilo uložiť. Skontrolujte údaje.</p>
      )}
      <section className="card">
        <h2>Moje formy</h2>
        <p>
          Predvoľby nie sú vlastníctvom. Potvrďte iba formy, ktoré skutočne
          máte.
        </p>
        <div className="cube-grid">
          {[250, 500].map((ml) => (
            <form action={addMold} key={ml}>
              <h3>
                {ml} ml · {ml === 250 ? 4 : 2} priehradky
              </h3>
              <div className="mold-cells">
                {Array.from({ length: ml === 250 ? 4 : 2 }, (_, i) => (
                  <span key={i}>{ml} ml</span>
                ))}
              </div>
              <input type="hidden" name="name" value={`Forma ${ml} ml`} />
              <input type="hidden" name="cell_ml" value={ml} />
              <input type="hidden" name="cells" value={ml === 250 ? 4 : 2} />
              <label>
                Počet vlastnených foriem {ml} ml
                <input
                  name="owned_count"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={1}
                  required
                />
              </label>
              <button>Potvrdiť vlastníctvo {ml} ml</button>
            </form>
          ))}
        </div>
        {molds.map((m) => (
          <p key={m.id}>
            <strong>{m.name}</strong> · {m.owned_count}× {m.cells} priehradiek
            po {m.cell_ml} ml · obsadených{" "}
            {cubes.filter((c) => c.mold_id === m.id).length}
          </p>
        ))}
        <details>
          <summary>Pridať vlastnú formu</summary>
          <form action={addMold}>
            <label>
              Názov formy
              <input name="name" maxLength={100} required />
            </label>
            <label>
              Počet priehradiek
              <input name="cells" type="number" min={1} max={30} required />
            </label>
            <label>
              Kapacita priehradky (ml)
              <input name="cell_ml" type="number" min={1} max={2000} required />
            </label>
            <label>
              Koľko foriem vlastním
              <input
                name="owned_count"
                type="number"
                min={1}
                max={100}
                required
              />
            </label>
            <button>Pridať vlastnú formu</button>
          </form>
        </details>
      </section>
      <h2>Rozporciovať novú várku</h2>
      {molds.length > 0 ? (
        <CubeBatchEditor
          recipes={recipes}
          molds={molds}
          request={randomUUID()}
          today={today}
          selected={params.version}
        />
      ) : (
        <p>Najprv potvrďte vlastníctvo formy.</p>
      )}
      <h2>Pripravené várky</h2>
      {batches.length === 0 && <p>Zatiaľ nemáte rozpracované kocky.</p>}
      {batches.map((b) => (
        <section key={b.id} className="card">
          <h2>{b.recipe_versions.name}</h2>
          <VacuumEditor
            batch={b}
            cubes={cubes.filter((c) => c.batch_id === b.id)}
            locations={locations}
            request={randomUUID()}
            today={today}
          />
        </section>
      ))}
    </div>
  );
}
