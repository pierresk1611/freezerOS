import { type SupabaseClient } from "@supabase/supabase-js";
import { readAll } from "./report-pages";
import {
  contentKey,
  importError,
  previewRows,
  stable,
  sourceKey,
  type ImportFile,
  type ExistingRecipe,
} from "./recipe-import";
export async function importState(client: SupabaseClient, files: ImportFile[]) {
  const ids = files.map((f) => f.data.importId);
  const [versions, requests, sources, items] = await Promise.all([
    readAll((a, b) =>
      client
        .from("recipe_versions")
        .select("*,recipes(archived)")
        .order("id")
        .range(a, b),
    ),
    client
      .from("operation_requests")
      .select("id,operation,payload")
      .in("id", ids),
    client
      .from("recipe_import_sources")
      .select("import_id,payload,legacy")
      .in("import_id", ids),
    client.from("recipe_import_items").select("*").in("import_id", ids),
  ]);
  if (versions.error) throw new Error(importError(versions.error));
  if (requests.error) throw new Error(importError(requests.error));
  for (const r of [sources, items])
    if (r.error && !["PGRST205", "42P01"].includes(r.error.code))
      throw new Error(importError(r.error));
  const available = !sources.error && !items.error;
  const existing: ExistingRecipe[] = (versions.data ?? []).map((v) => ({
    id: v.id,
    recipe_id: v.recipe_id,
    name: v.name,
    version: v.version,
    archived: v.recipes.archived,
    content: contentKey(v),
  }));
  const legacy = new Set<string>();
  const conflicts = new Set<string>();
  for (const file of files) {
    const source = sources.data?.find(
      (s) => s.import_id === file.data.importId,
    );
    const request = requests.data?.find((r) => r.id === file.data.importId);
    if (source) {
      if (stable(source.payload) !== stable(file.data.payload))
        conflicts.add(file.data.importId);
      else if (source.legacy) legacy.add(file.data.importId);
    } else if (request) {
      if (
        request.operation === "recipes" &&
        sourceKey(request.payload) === sourceKey(file.data.payload)
      )
        legacy.add(file.data.importId);
      else conflicts.add(file.data.importId);
    }
  }
  const processed = new Set(
    (items.data ?? []).map((i) => `${i.import_id}:${i.item_index}`),
  );
  const rows = previewRows(files, existing, processed, legacy).map((row) =>
    conflicts.has(files[row.file].data.importId)
      ? {
          ...row,
          conflict: true,
          error: "Toto importId už bolo použité s iným obsahom.",
        }
      : row,
  );
  const latest = existing.filter(
    (v) =>
      !existing.some(
        (x) => x.recipe_id === v.recipe_id && x.version > v.version,
      ),
  );
  return {
    rows: rows.map((row) => ({
      ...row,
      duplicates: latest.filter((v) =>
        row.duplicates.some((x) => x.recipe_id === v.recipe_id),
      ),
    })),
    available,
    items: items.data ?? [],
    legacy: [...legacy],
  };
}
