import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { randomUUID } from "node:crypto";
import { loadRecipe } from "@/lib/recipes";
import { cook } from "../../../actions";
export default async function BatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const r = await loadRecipe((await params).id);
  return (
    <div className="recipe-page recipe-editor-page">
      <Link href={"/recipes/" + r.recipe_id} className="back-link">
        <ArrowLeft size={18} />
        Späť na recept
      </Link>
      <div className="eyebrow">Z KUCHYNE DO MRAZNIČKY</div>
      <h1>Navariť várku</h1>
      <p className="muted">
        {r.name} · verzia {r.version}
      </p>
      {r.freezing && (
        <Link className="button" href={"/portioning?version=" + r.id}>
          Rozporciovať várku do foriem — rôzne hmotnosti
        </Link>
      )}
      {r.freezing ? (
        <form action={cook} className="card">
          <input type="hidden" name="version_id" value={r.id} />
          <input type="hidden" name="request_id" value={randomUUID()} />
          <label>
            Výsledná hmotnosť (g)
            <input name="weight" type="number" min={1} max={1000000} required />
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
          <p className="muted">
            Hmotnosť musí byť deliteľná počtom balíčkov na celé gramy.
          </p>
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
          <p className="muted">
            {r.storage} Dátum kvality nie je univerzálnou hranicou bezpečnosti.
          </p>
          <button>Vytvoriť várku a zásoby</button>
        </form>
      ) : (
        <section className="card">
          <h2>Tento recept nemrazte</h2>
          <p>{r.storage}</p>
        </section>
      )}
    </div>
  );
}
