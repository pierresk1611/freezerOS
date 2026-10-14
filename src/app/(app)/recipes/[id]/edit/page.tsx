import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { randomUUID } from "node:crypto";
import { loadRecipe } from "@/lib/recipes";
import { recipeSchema } from "@/lib/domain";
import { RecipeEditor } from "../../editor";
export default async function EditRecipe({
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
      <div className="eyebrow">ÚPRAVA · VERZIA {r.version}</div>
      <h1>Vyladiť recept</h1>
      <p className="muted">
        Uložením vznikne verzia {r.version + 1}. Už uvarené várky si zachovajú
        pôvodné údaje.
      </p>
      <RecipeEditor
        recipeId={r.recipe_id}
        photos={r.photos}
        requestId={randomUUID()}
        initial={recipeSchema.parse(r)}
        versionId={r.id}
        cancelHref={"/recipes/" + r.recipe_id}
      />
    </div>
  );
}
