import seed from "../../../../../docs/pulled-recipes.json";
import { userDb } from "@/lib/supabase";
import { importSchema } from "@/lib/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
async function confirm() {
  "use server";
  const { client } = await userDb();
  const parsed = importSchema.parse(seed);
  const result = await client.rpc("import_recipes", {
    p_import_id: parsed.importId,
    p_recipes: parsed.payload,
  });
  if (result.error) redirect("/recipes/pulled?error=1");
  revalidatePath("/", "layout");
  redirect("/recipes?created=1");
}
export default async function Pulled({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const p = await searchParams;
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
      {p.error && (
        <p role="alert">
          Import zlyhal. Aktivujte migráciu 005 a skúste znova.
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
          Pridaním výslovne potvrdzujete import všetkých štyroch šablón.
          Opakované potvrdenie nevytvorí ďalšie recepty.
        </p>
        <button>Potvrdiť pridanie 4 receptov</button>
      </form>
    </div>
  );
}
