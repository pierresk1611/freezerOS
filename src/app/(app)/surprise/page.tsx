import Link from "next/link";
import {
  favoriteDefaults,
  combinationDefaults,
  softPreferenceScore,
} from "@/lib/portioning";
import { requestTime } from "@/lib/time";
import { userDb } from "@/lib/supabase";
import { recommend, money, remainingValue } from "@/lib/domain";
export default async function Surprise() {
  const { client } = await userDb();
  const [{ data: items, error }, { data: recent, error: recentError }] =
    await Promise.all([
      client
        .from("inventory_packages")
        .select("*,cooking_batches(recipe_versions(*))")
        .gt("remaining_g", 0),
      client
        .from("meal_logs")
        .select("name")
        .gte(
          "created_at",
          new Date(requestTime() - 14 * 86400000).toISOString(),
        ),
    ]);
  if (error || recentError) throw error || recentError;
  const { data: prefs } = await client
    .from("food_preferences")
    .select("*")
    .maybeSingle();
  const scores = Object.fromEntries(
    (items ?? []).map((p) => {
      const r = p.cooking_batches?.recipe_versions;
      return [
        p.id,
        r
          ? softPreferenceScore(
              { ...r, ...r.metadata },
              prefs?.favorites ?? favoriteDefaults,
              prefs?.combinations ?? combinationDefaults,
            )
          : 0,
      ];
    }),
  );
  const result = recommend(
    items ?? [],
    recent?.map((m) => m.name) ?? [],
    new Date(),
    scores,
  );
  return (
    <div className="stack">
      <h1>🎲 Prekvap ma!</h1>
      {result ? (
        <article className="card">
          <span className="badge">Z VAŠICH ZÁSOB</span>
          <h2 style={{ marginTop: 20 }}>{result.item.name}</h2>
          <p>{result.reason}</p>
          <p>
            {result.item.remaining_g} g ·{" "}
            {money(
              result.item.cost_minor === null
                ? null
                : remainingValue(result.item)!,
            )}
          </p>
          <p className="muted">
            Výživové hodnoty: neznáme. Základný výber zohľadňuje dátum a
            opakovanie a mäkké chuťové preferencie.
          </p>
          <Link className="button" href={"/inventory?id=" + result.item.id}>
            Toto si dám — vybrať množstvo
          </Link>
          <Link className="text-link" href="/meal-plan">
            Pridať do jedálnička
          </Link>
          <p>
            <small>Odporúčanie samo o sebe neodpisuje zásoby.</small>
          </p>
        </article>
      ) : (
        <div className="card">
          <h2>Zatiaľ nie je z čoho vyberať</h2>
          <p>Najprv pridajte uvarenú várku do mrazničky.</p>
          <Link className="button" href="/recipes">
            Otvoriť recepty
          </Link>
        </div>
      )}
    </div>
  );
}
