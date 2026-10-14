import { userDb } from "@/lib/supabase";
import {
  favoriteDefaults,
  combinationDefaults,
  softPreferenceScore,
} from "@/lib/portioning";
import { recipeRecord } from "@/lib/recipes";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import Link from "next/link";
async function add(form: FormData) {
  "use server";
  const p = z
    .object({
      version: z.string().uuid(),
      date: z.iso.date(),
      slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
      portions: z.coerce.number().min(0.01).max(100),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/meal-plan?error=1");
  const { client, user } = await userDb();
  const result = await client.from("meal_plan_entries").insert({
    user_id: user.id,
    recipe_version_id: p.data.version,
    meal_date: p.data.date,
    slot: p.data.slot,
    portions: p.data.portions,
  });
  if (result.error) redirect("/meal-plan?error=1");
  revalidatePath("/meal-plan");
  redirect("/meal-plan");
}
async function remove(form: FormData) {
  "use server";
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) redirect("/meal-plan?error=1");
  const { client } = await userDb();
  const r = await client.from("meal_plan_entries").delete().eq("id", id.data);
  if (r.error) redirect("/meal-plan?error=1");
  revalidatePath("/meal-plan");
  redirect("/meal-plan");
}
const slots = {
  breakfast: "Raňajky",
  lunch: "Obed",
  dinner: "Večera",
  snack: "Snack",
};
export default async function Plan({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { client } = await userDb();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const days = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(today + "T12:00:00Z") + i * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const [recipes, prefs, entries, stock] = await Promise.all([
    client.from("recipe_latest").select("*"),
    client.from("food_preferences").select("*").maybeSingle(),
    client
      .from("meal_plan_entries")
      .select("*,recipe_versions(name,recipe_id)")
      .gte("meal_date", days[0])
      .lte("meal_date", days[6]),
    client
      .from("inventory_packages")
      .select(
        "remaining_g,portions,initial_g,cooking_batches(recipe_versions(recipe_id))",
      )
      .gt("remaining_g", 0)
      .overrideTypes<
        Array<{
          remaining_g: number;
          initial_g: number;
          portions: number | null;
          cooking_batches: { recipe_versions: { recipe_id: string } };
        }>,
        { merge: false }
      >(),
  ]);
  if (entries.error)
    return (
      <section className="card">
        <h1>Jedálniček</h1>
        <p>Aktivujte migráciu 005.</p>
      </section>
    );
  const ordered = (recipes.data ?? [])
    .map((r) => recipeRecord(r))
    .sort(
      (a, b) =>
        softPreferenceScore(
          b,
          prefs.data?.favorites ?? favoriteDefaults,
          prefs.data?.combinations ?? combinationDefaults,
        ) -
        softPreferenceScore(
          a,
          prefs.data?.favorites ?? favoriteDefaults,
          prefs.data?.combinations ?? combinationDefaults,
        ),
    );
  return (
    <div className="recipe-page">
      <h1>Jedálniček na 7 dní</h1>
      <Link href="/preferences">Upraviť moje chute</Link>
      <p>
        Recepty v ponuke sú zoradené podľa mäkkých preferencií. Plánovanie
        neodpisuje sklad.
      </p>
      {(await searchParams).error && (
        <p role="alert">Jedlo sa nepodarilo uložiť.</p>
      )}
      <form action={add} className="card">
        <label>
          Recept
          <select aria-label="Recept" name="version" required>
            {ordered.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Deň
          <input
            type="date"
            name="date"
            defaultValue={today}
            min={days[0]}
            max={days[6]}
            required
          />
        </label>
        <label>
          Jedlo
          <select aria-label="Jedlo" name="slot">
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
            name="portions"
            min=".01"
            max="100"
            step=".01"
            defaultValue={1}
            required
          />
        </label>
        <button>Pridať do jedálnička</button>
      </form>
      <div className="cube-grid">
        {days.map((day) => (
          <section className="card" key={day}>
            <h2>
              {new Intl.DateTimeFormat("sk-SK", {
                weekday: "long",
                day: "numeric",
                month: "numeric",
                timeZone: "Europe/Prague",
              }).format(new Date(day + "T12:00:00Z"))}
            </h2>
            {(entries.data ?? [])
              .filter((e) => e.meal_date === day)
              .map((e) => {
                const matching = (stock.data ?? []).filter(
                  (p) =>
                    p.cooking_batches?.recipe_versions?.recipe_id ===
                    e.recipe_versions.recipe_id,
                );
                const known =
                  matching.length > 0 &&
                  matching.every((p) => p.portions !== null);
                const available = matching.reduce(
                  (s, p) =>
                    s + ((p.portions ?? 0) * p.remaining_g) / p.initial_g,
                  0,
                );
                const needed = (entries.data ?? [])
                  .filter(
                    (x) =>
                      x.recipe_versions.recipe_id ===
                      e.recipe_versions.recipe_id,
                  )
                  .reduce((s, x) => s + Number(x.portions), 0);
                return (
                  <article key={e.id}>
                    <h3>
                      {slots[e.slot as keyof typeof slots]} ·{" "}
                      {e.recipe_versions.name}
                    </h3>
                    <p>{e.portions} porcií</p>
                    <p>
                      {!matching.length
                        ? "Nie je v mrazničke — treba navariť."
                        : !known
                          ? "Dostupnú hmotnosť evidujeme, počet porcií starších balíčkov nie je známy."
                          : available < needed
                            ? "Zásoba nestačí pre celý plán."
                            : `Dostupných približne ${available.toFixed(2)} porcií.`}
                    </p>
                    <form action={remove}>
                      <input type="hidden" name="id" value={e.id} />
                      <button>Odstrániť z plánu</button>
                    </form>
                  </article>
                );
              })}
          </section>
        ))}
      </div>
    </div>
  );
}
