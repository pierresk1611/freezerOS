import type { SupabaseClient } from "@supabase/supabase-js";
export type RecipePhoto = {
  id: string;
  url: string;
  thumbnail: string;
  alt: string;
  source_type: "own" | "external";
  source_url: string | null;
  author: string | null;
  license: string | null;
  position: number;
  is_primary: boolean;
};
export async function loadRecipePhotos(
  client: SupabaseClient,
  ids: string[],
): Promise<Map<string, RecipePhoto[]> & { needsMigration: boolean }> {
  const result = Object.assign(new Map<string, RecipePhoto[]>(), {
    needsMigration: false,
  });
  if (!ids.length) return result;
  const { data, error } = await client
    .from("recipe_photos")
    .select("*")
    .in("recipe_id", ids)
    .order("is_primary", { ascending: false })
    .order("position");
  if (error) {
    if (["PGRST205", "42P01"].includes(error.code)) {
      result.needsMigration = true;
      return result;
    }
    throw error;
  }
  const paths = (data ?? []).flatMap((p) => [p.storage_path, p.thumbnail_path]);
  if (!paths.length) return result;
  const signed = await client.storage
    .from("recipe-photos")
    .createSignedUrls(paths, 3600);
  if (signed.error) throw signed.error;
  const urls = new Map(signed.data.map((p) => [p.path, p.signedUrl]));
  for (const p of data ?? []) {
    const photo = {
      ...p,
      url: urls.get(p.storage_path) ?? "",
      thumbnail: urls.get(p.thumbnail_path) ?? "",
    } as RecipePhoto;
    result.set(p.recipe_id, [...(result.get(p.recipe_id) ?? []), photo]);
  }
  return result;
}
