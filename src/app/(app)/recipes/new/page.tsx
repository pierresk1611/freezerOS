import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { randomUUID } from "node:crypto";
import { loadRecipe } from "@/lib/recipes";
import { recipeSchema } from "@/lib/domain";
import { RecipeEditor } from "../editor";
export default async function NewRecipe({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const source = from ? await loadRecipe(from) : null;
  return (
    <div className="recipe-page recipe-editor-page">
      <Link
        href={source ? "/recipes/" + source.recipe_id : "/recipes"}
        className="back-link"
      >
        <ArrowLeft size={18} />
        Späť
      </Link>
      <div className="eyebrow">VAŠA KUCHÁRKA</div>
      <h1>{source ? "Duplikovať recept" : "Nový recept"}</h1>
      <p className="muted">
        {source
          ? "Kópia bude samostatný recept. Pôvodný recept zostáva zachovaný."
          : "Uložte si jedlo, ku ktorému sa budete radi vracať."}
      </p>
      <RecipeEditor
        requestId={randomUUID()}
        initial={
          source
            ? { ...recipeSchema.parse(source), name: source.name + " — kópia" }
            : undefined
        }
        cancelHref={source ? "/recipes/" + source.recipe_id : "/recipes"}
      />
    </div>
  );
}
