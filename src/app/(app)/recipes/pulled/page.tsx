import seed from "../../../../../docs/pulled-recipes.json";
import { userDb } from "@/lib/supabase";
import { pulledFile, pulledImportState } from "@/lib/pulled-import";
import { importError } from "@/lib/recipe-import";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
async function confirm() {
  "use server";
  const { client } = await userDb();
  const state = await pulledImportState(client);
  for (const { row, imported } of state.recipes) {
    if (imported) continue;
    const result = await client.rpc("import_recipe_item", {
      p_import_id: pulledFile.data.importId,
      p_payload: pulledFile.data.payload,
      p_index: row.index,
      p_mode: "new",
      p_target: null,
    });
    if (result.error) {
      revalidatePath("/recipes");
      redirect(
        "/recipes/pulled?error=" +
          encodeURIComponent(importError(result.error)),
      );
    }
  }
  revalidatePath("/recipes");
  revalidatePath("/recipes/pulled");
  redirect("/recipes/pulled?added=1");
}
export default async function Pulled({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const p = await searchParams;
  const { client } = await userDb();
  const state = await pulledImportState(client);
  return (
    <div className="recipe-page">
      <Link href="/recipes">Späť do kuchárky</Link>
      <h1>Pomaly pečené a trhané mäso</h1>
      <p>
        Štyri nové editovateľné šablóny pre šesť plánovaných porcií. Skutočný
        výťažok po varení odvážte. Ceny a výživové hodnoty nie sú zadané.
      </p>
      <p>
        Pôvodných 15 receptov zostáva zachovaných. Sticky Ginger Pulled Pork je
        samostatný recept; pôvodný Sticky ginger pork sa neprepisuje.
      </p>
      {p.error && <p role="alert">{p.error.slice(0, 1000)}</p>}
      {state.count === 4 ? (
        <section className="card" role="status">
          <h2>4 recepty už boli pridané</h2>
          <p>Existujúce recepty a ich úpravy zostávajú zachované.</p>
          <ul>
            {state.recipes.map(({ row, target }) => (
              <li key={row.key}>
                {target && !target.archived ? (
                  <Link href={`/recipes/${target.recipe_id}`}>
                    {target.name}
                  </Link>
                ) : (
                  <span>
                    {row.name}
                    {target?.archived
                      ? " (archivované)"
                      : " — evidované v staršom importe"}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <Link
            className="button"
            href="/recipes?category=slow_roasted_pulled_meat"
          >
            Trhané mäso v kuchárke
          </Link>
        </section>
      ) : (
        <>
          <p>
            {state.count
              ? `${state.count} receptov už existuje; pridajú sa iba chýbajúce.`
              : "Pred potvrdením si môžete prezrieť všetky štyri šablóny."}
          </p>
          {!state.available && (
            <p role="alert">
              Nový import vyžaduje aktiváciu migrácie 008. Existujúce recepty
              zostávajú zachované.
            </p>
          )}
          {seed.payload.map((r) => (
            <section className="card" key={r.name}>
              <h2>{r.name}</h2>
              <p>
                {r.prep_minutes} min príprava · {r.cooking_minutes_min}–
                {r.cooking_minutes_max} min pečenie · {r.oven_c} °C
              </p>
              <h3>Suroviny</h3>
              <ul>
                {r.ingredients.map((i) => (
                  <li key={i.name}>
                    {i.quantity} {i.unit} {i.name}
                  </li>
                ))}
              </ul>
              <h3>Postup</h3>
              <ol>
                {r.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <p>{r.storage}</p>
              <p>{r.reheating}</p>
            </section>
          ))}
          <form action={confirm} className="card">
            <p>
              Pridaním potvrdzujete import chýbajúcich šablón. Existujúce
              recepty sa neprepisujú.
            </p>
            <button disabled={!state.available}>
              {state.count === 0
                ? "Pridať 4 recepty"
                : `Pridať chýbajúce ${4 - state.count} recepty`}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
