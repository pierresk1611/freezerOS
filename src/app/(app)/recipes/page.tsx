import Link from "next/link";
import {
  Search,
  Plus,
  SlidersHorizontal,
  Snowflake,
  Users,
  ArrowUpRight,
  Clock,
  BookOpen,
} from "lucide-react";
import { randomUUID } from "node:crypto";
import { userDb } from "@/lib/supabase";
import { recipeRecord, meatLabels } from "@/lib/recipes";
import { RecipeMedia } from "./media";
import { RecipeMenu } from "./menu";
import { importDefaults } from "../actions";
export default async function Recipes({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    meat?: string;
    freezing?: string;
    error?: string;
    created?: string;
  }>;
}) {
  const params = await searchParams;
  const { client } = await userDb();
  const { data, error } = await client
    .from("recipe_latest")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const all = (data ?? []).map(recipeRecord);
  const q = (params.q ?? "").trim().toLocaleLowerCase("sk");
  const recipes = all.filter(
    (r) =>
      (!q || r.name.toLocaleLowerCase("sk").includes(q)) &&
      (!params.meat || r.meat === params.meat) &&
      (!params.freezing ||
        (params.freezing === "yes" ? r.freezing : !r.freezing)),
  );
  return (
    <div className="recipe-page">
      <header className="recipe-heading">
        <div>
          <div className="eyebrow">VAŠA OSOBNÁ KUCHÁRKA</div>
          <h1>
            Dobré jedlo sa začína
            <br className="desktop-break" /> dobrým receptom.
          </h1>
          <p className="muted">Obľúbené chute, pripravené na každý deň.</p>
        </div>
        <Link href="/recipes/new" className="button">
          <Plus size={18} />
          Nový recept
        </Link>
      </header>
      {params.created && (
        <p role="status" className="recipe-notice">
          Recept bol uložený do vašej kuchárky.
        </p>
      )}
      {params.error && (
        <p role="alert" className="error">
          Operácia sa nepodarila. Skontrolujte pripojenie a skúste znova.
        </p>
      )}
      <form method="get" className="recipe-filters">
        <div className="recipe-search">
          <Search size={20} />
          <label className="sr-only" htmlFor="recipe-search">
            Hľadať recept
          </label>
          <input
            id="recipe-search"
            name="q"
            defaultValue={params.q}
            placeholder="Na čo máte chuť?"
            maxLength={160}
          />
        </div>
        <label className="sr-only" htmlFor="meat-filter">
          Druh mäsa
        </label>
        <select id="meat-filter" name="meat" defaultValue={params.meat ?? ""}>
          <option value="">Všetky druhy</option>
          {Object.entries(meatLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="freeze-filter">
          Vhodnosť mrazenia
        </label>
        <select
          id="freeze-filter"
          name="freezing"
          defaultValue={params.freezing ?? ""}
        >
          <option value="">Mrazenie: všetky</option>
          <option value="yes">Vhodné na mrazenie</option>
          <option value="no">Nemraziť</option>
        </select>
        <button>
          <SlidersHorizontal size={17} />
          Filtrovať
        </button>
        {(q || params.meat || params.freezing) && (
          <Link href="/recipes" className="text-link">
            Zrušiť filtre
          </Link>
        )}
      </form>
      <div className="recipe-section-bar">
        <h2>
          Vaše recepty <span>{recipes.length}</span>
        </h2>
        <Link href="/recipes/import" className="text-link">
          Importovať JSON <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="recipe-gallery">
        {recipes.map((r) => (
          <article className="recipe-tile" key={r.recipe_id}>
            <Link
              href={"/recipes/" + r.recipe_id}
              aria-label={"Otvoriť " + r.name}
            >
              <RecipeMedia photos={r.photos} />
            </Link>
            <div className="recipe-tile-body">
              <div className="recipe-tile-top">
                <span className="recipe-category">{meatLabels[r.meat]}</span>
                <RecipeMenu
                  id={r.recipe_id}
                  name={r.name}
                  requestId={randomUUID()}
                />
              </div>
              <h2>
                <Link href={"/recipes/" + r.recipe_id}>{r.name}</Link>
              </h2>
              <div className="recipe-meta">
                <span>
                  <Users size={16} />
                  {r.portions} porcie
                </span>
                {r.prep_minutes && (
                  <span>
                    <Clock size={16} />
                    {r.prep_minutes} min
                  </span>
                )}
                <span className={r.freezing ? "freeze-ok" : "muted"}>
                  <Snowflake size={16} />
                  {r.freezing ? "Na mrazenie" : "Nemraziť"}
                </span>
              </div>
              <Link href={"/recipes/" + r.recipe_id} className="recipe-open">
                Otvoriť recept <ArrowUpRight size={18} />
              </Link>
            </div>
          </article>
        ))}
      </div>
      {!recipes.length && (
        <section className="recipe-empty">
          <BookOpen size={36} strokeWidth={1.2} />
          <h2>
            {all.length
              ? "Žiadny recept nezodpovedá filtrom"
              : "Vaša kuchárka čaká na prvý recept"}
          </h2>
          <p className="muted">
            {all.length
              ? "Skúste inú chuť alebo zrušte filtre."
              : "Pridajte vlastný recept alebo začnite pripravenými šablónami."}
          </p>
          {all.length ? (
            <Link href="/recipes" className="button">
              Zrušiť filtre
            </Link>
          ) : (
            <form action={importDefaults}>
              <button>Pridať 15 receptových šablón</button>
              <p>
                <small>Bez vymyslených cien a výživových hodnôt.</small>
              </p>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
