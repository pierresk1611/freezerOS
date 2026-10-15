import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { z } from "zod";
import { userDb } from "@/lib/supabase";
import { recipeRecord } from "@/lib/recipes";
import { loadRecipePhotos } from "@/lib/recipe-photos";
export default async function Snapshot({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { client } = await userDb();
  const result = await client
    .from("recipe_versions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw Error(result.error.message);
  if (!result.data) notFound();
  const recipe = recipeRecord(result.data);
  const [root, photos] = await Promise.all([
    client
      .from("recipes")
      .select("archived")
      .eq("id", recipe.recipe_id)
      .maybeSingle(),
    loadRecipePhotos(client, [recipe.recipe_id]),
  ]);
  if (root.error) throw Error(root.error.message);
  const image = photos.get(recipe.recipe_id)?.[0];
  return (
    <div className="recipe-page">
      <Link href="/meal-plan">← Jedálniček</Link>
      <p className="eyebrow">Nemenná naplánovaná verzia · {recipe.version}</p>
      <h1>{recipe.name}</h1>
      <p>
        {recipe.portions} porcií
        {recipe.prep_minutes ? ` · príprava ${recipe.prep_minutes} min` : ""}
      </p>
      {image && (
        <Image
          className="snapshot-photo"
          src={image.url}
          width={1000}
          height={600}
          alt={image.alt || recipe.name}
          unoptimized
        />
      )}
      <p>
        Toto sú pôvodné údaje verzie použitej v pláne a nákupných prepočtoch.
        Neskoršia úprava receptu ich nemení. Fotografia, ak je dostupná, patrí k
        aktuálnej galérii receptu.
      </p>
      {root.data?.archived ? (
        <p>Recept je archivovaný. Táto naplánovaná verzia zostáva čitateľná.</p>
      ) : (
        <Link href={"/recipes/" + recipe.recipe_id}>
          Otvoriť aktuálny recept
        </Link>
      )}
      <div className="shopping-layout">
        <section className="card">
          <h2>Suroviny</h2>
          <ul>
            {recipe.ingredients.map((i, k) => (
              <li key={k}>
                {i.name} · {i.quantity} {i.unit}
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>Postup varenia</h2>
          <ol>
            {recipe.steps.map((step, k) => (
              <li key={k}>{step}</li>
            ))}
          </ol>
        </section>
      </div>
      <section className="card">
        <h2>Skladovanie a mrazenie</h2>
        <p>{recipe.storage}</p>
        <h2>Zohrievanie / dokončenie prípravy</h2>
        <p>{recipe.reheating}</p>
      </section>
    </div>
  );
}
