import { logout } from "../../login/actions";
import Link from "next/link";
import { userDb } from "@/lib/supabase";
import { favoriteDefaults, combinationDefaults } from "@/lib/portioning";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
async function save(form: FormData) {
  "use server";
  const list = z.array(z.string().trim().min(1).max(120)).max(30);
  const favorites = list.safeParse(
      String(form.get("favorites"))
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
    combinations = list.safeParse(
      String(form.get("combinations"))
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
    );
  if (!favorites.success || !combinations.success)
    redirect("/preferences?error=1");
  const { client, user } = await userDb();
  const r = await client
    .from("food_preferences")
    .upsert({
      user_id: user.id,
      favorites: favorites.data,
      combinations: combinations.data,
      updated_at: new Date().toISOString(),
    });
  if (r.error) redirect("/preferences?error=1");
  revalidatePath("/", "layout");
  redirect("/preferences?saved=1");
}
export default async function Preferences({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const p = await searchParams;
  const { client } = await userDb();
  const { data, error } = await client
    .from("food_preferences")
    .select("*")
    .maybeSingle();
  return (
    <div className="recipe-page">
      <h1>Moje chute</h1>
      <div className="photo-actions">
        <Link href="/meal-plan">Jedálniček</Link>
        <Link href="/portioning">Formy a porciovanie</Link>
      </div>
      <p>
        Mäkké preferencie pomáhajú pri odporúčaniach a plánovaní. Nevylučujú
        ostatné jedlá.
      </p>
      {(p.error || error) && (
        <p role="alert">
          Preferencie nie sú dostupné. Skontrolujte údaje a aktiváciu migrácie
          005.
        </p>
      )}
      {p.saved && <p role="status">Preferencie boli uložené.</p>}
      <form action={save} className="card">
        <label>
          Veľmi obľúbené (jedna položka na riadok)
          <textarea
            rows={8}
            name="favorites"
            defaultValue={(data?.favorites ?? favoriteDefaults).join("\n")}
          />
        </label>
        <label>
          Preferované kombinácie (jedna na riadok)
          <textarea
            rows={6}
            name="combinations"
            defaultValue={(data?.combinations ?? combinationDefaults).join(
              "\n",
            )}
          />
        </label>
        <button>Uložiť moje chute</button>
      </form>
      <form action={logout}>
        <button>Odhlásiť sa</button>
      </form>
    </div>
  );
}
