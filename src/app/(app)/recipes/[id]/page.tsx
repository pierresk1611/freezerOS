import { userDb } from "@/lib/supabase";
import { money } from "@/lib/domain";
import Link from "next/link";
import {
  ArrowLeft,
  Users,
  Snowflake,
  ChefHat,
  Copy,
  Pencil,
  Play,
  Clock,
} from "lucide-react";
import { loadRecipe, meatLabels } from "@/lib/recipes";
import { RecipeMedia } from "../media";
export default async function RecipeDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const r = await loadRecipe((await params).id);
  const saved = (await searchParams).saved;
  const { client } = await userDb();
  const { data: batch, error: batchError } = await client
    .from("cooking_batches")
    .select("cost_minor,weight_g,created_at")
    .eq("recipe_version_id", r.id)
    .not("cost_minor", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (batchError) throw batchError;
  const { data: references, error: referenceError } = await client
    .from("recipe_image_references")
    .select("id,reference")
    .eq("recipe_id", r.recipe_id)
    .eq("status", "pending");
  if (referenceError && !["PGRST205", "42P01"].includes(referenceError.code))
    throw referenceError;
  return (
    <div className="recipe-page recipe-detail">
      <Link href="/recipes" className="back-link">
        <ArrowLeft size={18} />
        Späť do kuchárky
      </Link>
      {referenceError && (
        <p role="status" className="recipe-notice">
          Fotografie čakajú na aktiváciu databázovej migrácie.
        </p>
      )}
      {saved && (
        <p role="status" className="recipe-notice">
          Nová verzia receptu bola uložená. Historické várky sa nemenia.
        </p>
      )}
      <div className="recipe-detail-hero">
        <RecipeMedia photos={r.photos} large />
        <div className="recipe-intro">
          <div className="eyebrow">
            {meatLabels[r.meat]} · VERZIA {r.version}
          </div>
          <h1>{r.name}</h1>
          {r.description && <p className="muted">{r.description}</p>}
          <div className="recipe-meta">
            <span>
              <Users size={18} />
              {r.portions} porcie
            </span>
            <span>
              <Snowflake size={18} />
              {r.freezing ? "Vhodné na mrazenie" : "Nemraziť"}
            </span>
            {r.prep_minutes && (
              <span>
                <Clock size={18} />
                {r.prep_minutes} min
              </span>
            )}
          </div>
          <div className="recipe-detail-actions">
            <Link
              className="button"
              href={"/recipes/" + r.recipe_id + "/batch"}
            >
              <ChefHat size={18} />
              Navariť várku
            </Link>
            <Link
              className="button button-secondary"
              href={"/recipes/" + r.recipe_id + "/cook"}
            >
              <Play size={18} />
              Režim varenia
            </Link>
            <Link
              className="text-link"
              href={"/recipes/" + r.recipe_id + "/edit"}
            >
              <Pencil size={16} />
              Upraviť recept
            </Link>
            <Link
              className="text-link"
              href={"/recipes/new?from=" + r.recipe_id}
            >
              <Copy size={16} />
              Duplikovať
            </Link>
          </div>
        </div>
      </div>
      <Link
        href={"/recipes/" + r.recipe_id + "/edit#photos"}
        className="text-link"
      >
        Upraviť fotografie
      </Link>
      <div className="recipe-detail-content">
        <aside className="recipe-ingredients">
          <div className="eyebrow">VŠETKO, ČO POTREBUJETE</div>
          <h2>Suroviny</h2>
          <p className="muted">Na {r.portions} porcie</p>
          <ul>
            {r.ingredients.map((i, n) => (
              <li key={n}>
                <span>{i.name}</span>
                <strong>
                  {new Intl.NumberFormat("sk-SK").format(i.quantity)}{" "}
                  <small>{i.unit}</small>
                </strong>
              </li>
            ))}
          </ul>
        </aside>
        <section className="recipe-method">
          <div className="eyebrow">KROK ZA KROKOM</div>
          <h2>Poďme variť</h2>
          <ol>
            {r.steps.map((s, n) => (
              <li key={n}>
                <span className="step-number">
                  {String(n + 1).padStart(2, "0")}
                </span>
                <p>{s}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="recipe-storage-grid">
        <section className="card">
          <Snowflake size={24} />
          <h2>Mrazenie a skladovanie</h2>
          <p>{r.storage}</p>
        </section>
        <section className="card">
          <ChefHat size={24} />
          <h2>Rozmrazovanie a zohrievanie</h2>
          <p>{r.reheating}</p>
        </section>
      </div>
      {!!references?.length && (
        <section className="card">
          <h2>Obrazové referencie z importu</h2>
          <p>
            Čakajú na overenie obsahu a licencie. Aplikácia ich automaticky
            nesťahuje.
          </p>
          <ul>
            {references.map((ref) => (
              <li key={ref.id}>
                <a
                  href={ref.reference.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {ref.reference.alt}
                </a>{" "}
                · {ref.reference.author} · {ref.reference.license}
              </li>
            ))}
          </ul>
          <p>
            Po overení práv môžete fotografiu nahrať do editora. Označenie
            externého zdroja musí byť zachované; bežný upload je určený vašim
            vlastným záberom.
          </p>
        </section>
      )}
      <section className="recipe-data-note">
        <h2>Výživa a Food Cost</h2>
        <p className="muted">
          Výživové hodnoty tohto receptu zatiaľ nie sú evidované.
        </p>
        {batch ? (
          <p>
            <strong>{money(Number(batch.cost_minor))}</strong> · skutočné
            náklady poslednej várky tejto verzie ({batch.weight_g} g).{" "}
            <span className="muted">
              Cena porcie sa bez skutočného počtu porcií neodhaduje.
            </span>
          </p>
        ) : (
          <p className="muted">
            Cena zatiaľ nie je známa. Skutočné náklady môžete zadať pri
            vytvorení várky.
          </p>
        )}
      </section>
    </div>
  );
}
