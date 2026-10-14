import { recipeSchema } from "@/lib/domain";
import { RecipeEditor, ImportEditor } from "./editor";
import { userDb } from "@/lib/supabase";
import { cook, archiveRecipe, importDefaults } from "../actions";
import { randomUUID } from "crypto";
export default async function Recipes({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { client } = await userDb();
  const { data: versions, error: loadError } = await client
    .from("recipe_latest")
    .select("*")
    .order("created_at", { ascending: false });
  if (loadError) throw loadError;
  return (
    <div className="stack">
      <h1>Kniha receptov</h1>
      {error && (
        <p role="alert" className="error">
          Údaje sú neplatné alebo operácia zlyhala. Skontrolujte vstupy a
          pripojenie.
        </p>
      )}
      <details className="card">
        <summary>+ Nový recept</summary>
        <RecipeEditor requestId={randomUUID()} />
      </details>
      <details className="card">
        <summary>Import receptov z JSON</summary>
        <p>
          Schéma 1.0, importType recipes. Rovnaké importId sa spracuje iba raz.
        </p>
        <ImportEditor />
      </details>
      <form action={importDefaults}>
        <button>Pridať 15 počiatočných receptov</button>
        <p className="muted">
          Editovateľné šablóny; náklady a výživa zostanú neznáme. Rovnaká sada
          sa importuje iba raz.
        </p>
      </form>
      <div className="grid">
        {versions?.map((v) => (
          <article className="card" key={v.id}>
            <span className="badge">
              {v.portions} porcie · verzia {v.version}
            </span>
            <h2 style={{ marginTop: 16 }}>{v.name}</h2>
            <ul>
              {v.ingredients.map(
                (
                  i: { name: string; quantity: number; unit: string },
                  n: number,
                ) => (
                  <li key={n}>
                    {i.quantity} {i.unit} {i.name}
                  </li>
                ),
              )}
            </ul>
            <details>
              <summary>Postup varenia</summary>
              <ol>
                {v.steps.map((s: string, n: number) => (
                  <li key={n}>
                    <p>{s}</p>
                  </li>
                ))}
              </ol>
              <p>
                <strong>Zohrievanie:</strong> {v.reheating}
              </p>
            </details>
            <p className="muted">{v.storage}</p>
            <details>
              <summary>Upraviť recept — nová verzia</summary>
              <RecipeEditor
                requestId={randomUUID()}
                initial={recipeSchema.parse(v)}
                versionId={v.id}
              />
            </details>
            <details>
              <summary>Duplikovať recept</summary>
              <RecipeEditor
                requestId={randomUUID()}
                initial={{
                  ...recipeSchema.parse(v),
                  name: v.name + " — kópia",
                }}
              />
            </details>
            <details>
              <summary>Archivovať recept</summary>
              <p>Historické várky zostanú zachované.</p>
              <form action={archiveRecipe}>
                <input type="hidden" name="recipe_id" value={v.recipe_id} />
                <input type="hidden" name="request_id" value={randomUUID()} />
                <button>Potvrdiť archiváciu</button>
              </form>
            </details>
            <details>
              <summary>Navariť novú várku</summary>
              <p>
                <small>
                  Náklady zadajte podľa skutočnej várky. Neznámu cenu nechajte
                  prázdnu.
                </small>
              </p>
              <form action={cook}>
                <input type="hidden" name="version_id" value={v.id} />
                <input type="hidden" name="request_id" value={randomUUID()} />
                <label>
                  Výsledná hmotnosť (g)
                  <input name="weight" type="number" min={1} required />
                </label>
                <label>
                  Počet rovnako veľkých balíčkov
                  <input
                    name="packages"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={2}
                    required
                  />
                </label>
                <label>
                  Celkové náklady (Kč)
                  <input
                    name="cost"
                    inputMode="decimal"
                    placeholder="Neznáme"
                    pattern="[0-9]+([.,][0-9]{1,2})?"
                  />
                </label>
                <label>
                  Odporúčaná spotreba pre kvalitu
                  <input name="best_before" type="date" required />
                </label>
                <p>
                  <small>
                    Jedlo rýchlo schlaďte; ryžu ideálne do jednej hodiny. Mrazte
                    približne pri −18 °C. Dátum kvality nie je univerzálnou
                    hranicou bezpečnosti.
                  </small>
                </p>
                <button disabled={!v.freezing}>Vytvoriť várku a zásoby</button>
                {!v.freezing && (
                  <p className="error">
                    Tento recept nie je vhodný na mrazenie.
                  </p>
                )}
              </form>
            </details>
          </article>
        ))}
      </div>
      {!versions?.length && (
        <p className="empty">
          Pridajte svoj prvý recept. Výživové hodnoty zatiaľ zostávajú neznáme.
        </p>
      )}
    </div>
  );
}
