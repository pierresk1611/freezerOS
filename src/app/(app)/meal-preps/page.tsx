import Link from "next/link";
import { userDb } from "@/lib/supabase";
import { prepStatuses } from "@/lib/meal-prep";
export default async function Page() {
  const { client } = await userDb();
  const { data, error } = await client
    .from("meal_prep_projects")
    .select("*")
    .order("created_at", { ascending: false });
  return (
    <section className="recipe-page">
      <p className="eyebrow">VARTE RAZ, JEDZTE S POKOJOM</p>
      <h1>Meal prepy</h1>
      <p>Recepty, spoločný nákup a organizácia varenia na jednom mieste.</p>
      <Link className="button" href="/meal-preps/import">
        Importovať od AI
      </Link>
      {error ? (
        <p role="alert" className="card">
          Pre projekty aktivujte migráciu 011 po migrácii 010. Existujúce
          recepty a zásoby zostávajú zachované.
        </p>
      ) : !data?.length ? (
        <p className="card">
          Zatiaľ nemáte meal-prep projekt. Začnite importom JSON alebo si
          stiahnite vzor.
        </p>
      ) : (
        <div className="recipe-grid">
          {data.map((p) => (
            <Link className="card" href={"/meal-preps/" + p.id} key={p.id}>
              <p>{prepStatuses[p.status as keyof typeof prepStatuses]}</p>
              <h2>{p.name}</h2>
              <p>{p.description}</p>
              <p>
                Varenie {p.cooking_date} · {p.days} dní · cieľ{" "}
                {p.target_portions} hlavných porcií
              </p>
              <strong>Otvoriť meal prep →</strong>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
