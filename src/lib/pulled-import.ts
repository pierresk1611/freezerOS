import seed from "../../docs/pulled-recipes.json";
import { normalizeFiles, normalizedText } from "./recipe-import";
import { importState } from "./recipe-import-server";
import type { SupabaseClient } from "@supabase/supabase-js";
export const pulledFile = normalizeFiles([
  { name: "pulled-recipes.json", data: seed },
])[0];
export async function pulledImportState(client: SupabaseClient) {
  const state = await importState(client, [pulledFile]);
  const recipes = state.rows.map((row) => {
    const item = state.items.find((i) => i.item_index === row.index);
    const target =
      row.duplicates.find((v) => v.recipe_id === item?.recipe_id) ??
      row.duplicates.find(
        (v) => normalizedText(v.name) === normalizedText(row.name),
      ) ??
      row.duplicates[0];
    return { row, target, imported: row.already || !!target };
  });
  return { ...state, recipes, count: recipes.filter((r) => r.imported).length };
}
