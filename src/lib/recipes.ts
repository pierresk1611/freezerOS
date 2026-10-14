import { userDb } from "./supabase";
import { recipeSchema } from "./domain";
import { z } from "zod";
import { notFound } from "next/navigation";
import { loadRecipePhotos, type RecipePhoto } from "./recipe-photos";
export type { RecipePhoto } from "./recipe-photos";
export type RecipeRecord = z.infer<typeof recipeSchema> & {
  id: string;
  recipe_id: string;
  version: number;
  description?: string;
  prep_minutes?: number;
  photos: RecipePhoto[];
};
export const meatLabels: Record<string, string> = {
  none: "Bez mäsa",
  beef: "Hovädzie",
  pork: "Bravčové",
  chicken: "Kuracie",
  other: "Ostatné mäso",
  fish: "Ryba",
};
export function recipeRecord(
  row: Record<string, unknown>,
  photos: RecipePhoto[] = [],
): RecipeRecord {
  return {
    ...recipeSchema.parse(row),
    id: String(row.id),
    recipe_id: String(row.recipe_id),
    version: Number(row.version),
    description:
      typeof row.description === "string" ? row.description : undefined,
    prep_minutes:
      typeof row.prep_minutes === "number" && row.prep_minutes > 0
        ? row.prep_minutes
        : undefined,
    photos,
  };
}
export async function loadRecipe(id: string) {
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { client } = await userDb();
  let result = await client
    .from("recipe_latest")
    .select("*")
    .eq("recipe_id", id)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    result = await client
      .from("recipe_latest")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (result.error) throw result.error;
  }
  if (!result.data) notFound();
  const photos = await loadRecipePhotos(client, [result.data.recipe_id]);
  return recipeRecord(result.data, photos.get(result.data.recipe_id));
}
