import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { loadRecipe } from "@/lib/recipes";
import { CookingMode } from "./mode";
export default async function CookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const r = await loadRecipe((await params).id);
  return (
    <div className="recipe-page">
      <Link href={"/recipes/" + r.recipe_id} className="back-link">
        <ArrowLeft size={18} />
        Späť na recept
      </Link>
      <CookingMode id={r.recipe_id} name={r.name} steps={r.steps} />
    </div>
  );
}
