import { z } from "zod";
import { importSchema, recipeSchema } from "./domain";
export const sourceSchema = importSchema
  .omit({ payload: true })
  .extend({ payload: z.array(z.unknown()).min(1).max(50) });
export const uploadedRecipeSchema = importSchema.shape.payload.element;
export const filesSchema = z
  .array(z.object({ name: z.string().min(1).max(240), data: sourceSchema }))
  .min(1)
  .max(10);
export type ImportFile = z.infer<typeof filesSchema>[number];
export type ImportRecipe = z.infer<typeof uploadedRecipeSchema>;
export const normalizedText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
export function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => JSON.stringify(k) + ":" + stable(v))
    .join(",")}}`;
}
export function contentKey(recipe: Record<string, unknown>) {
  const p = recipeSchema.parse({
    ...recipe,
    ...((recipe.metadata as object) ?? {}),
  });
  return stable({
    ...p,
    name: undefined,
    ingredients: p.ingredients
      .map((i) => ({ ...i, name: normalizedText(i.name) }))
      .sort((a, b) =>
        stable(a) < stable(b) ? -1 : stable(a) > stable(b) ? 1 : 0,
      ),
    steps: p.steps.map(normalizedText),
    storage: normalizedText(p.storage),
    reheating: normalizedText(p.reheating),
    category: p.category ?? "general",
  });
}
export function normalizeFiles(raw: unknown): ImportFile[] {
  const files = filesSchema.parse(raw);
  if (files.reduce((s, f) => s + f.data.payload.length, 0) > 200)
    throw new Error("Najviac 200 receptov v jednom náhľade.");
  return files.map((f) => ({
    ...f,
    data: {
      ...f.data,
      importId: f.data.importId.toLowerCase(),
      payload: f.data.payload.map((r) => {
        const p = uploadedRecipeSchema.safeParse(r);
        return p.success ? p.data : r;
      }),
    },
  }));
}
export type ExistingRecipe = {
  id: string;
  recipe_id: string;
  version: number;
  name: string;
  archived: boolean;
  content: string;
};
export type ImportRow = {
  key: string;
  file: number;
  index: number;
  name: string;
  recipe?: ImportRecipe;
  error?: string;
  already: boolean;
  conflict: boolean;
  duplicates: ExistingRecipe[];
  within: boolean;
};
export type ImportResult = {
  key: string;
  name: string;
  status: "added" | "version" | "skipped" | "duplicate" | "error";
  reason?: string;
  recipeId?: string | null;
  versionId?: string | null;
};
export function previewRows(
  files: ImportFile[],
  existing: ExistingRecipe[],
  processed: Set<string>,
  legacy: Set<string>,
) {
  const seen: { name: string; content: string; id: string; payload: string }[] =
    [];
  return files.flatMap((f, file) =>
    f.data.payload.map((raw, index) => {
      const key = `${file}:${index}`,
        id = `${f.data.importId}:${index}`,
        parsed = uploadedRecipeSchema.safeParse(raw);
      if (!parsed.success)
        return {
          key,
          file,
          index,
          name:
            typeof raw === "object" && raw && "name" in raw
              ? String(raw.name)
              : `Recept ${index + 1}`,
          error: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          already: false,
          conflict: false,
          duplicates: [],
          within: false,
        };
      const recipe = parsed.data,
        name = normalizedText(recipe.name),
        content = contentKey(recipe);
      const conflict = files.some(
        (other, n) =>
          n !== file &&
          other.data.importId === f.data.importId &&
          stable(other.data.payload) !== stable(f.data.payload),
      );
      const duplicates = existing.filter(
        (v) => normalizedText(v.name) === name || v.content === content,
      );
      const within = seen.some(
        (v) => v.name === name || v.content === content || v.id === id,
      );
      seen.push({ name, content, id, payload: stable(f.data.payload) });
      return {
        key,
        file,
        index,
        name: recipe.name,
        recipe,
        error: conflict
          ? "Rovnaké importId má v súboroch rozdielny obsah."
          : undefined,
        conflict,
        already: processed.has(id) || legacy.has(f.data.importId),
        duplicates,
        within,
      };
    }),
  );
}
export function importError(error: { message: string; code?: string }) {
  if (["PGRST202", "42883", "42P01", "PGRST205"].includes(error.code ?? ""))
    return "Hromadný import potrebuje aktivovať migráciu 008 v Supabase.";
  if (
    error.message.includes("SOURCE_CHANGED") ||
    error.message.includes("Request ID reused")
  )
    return "Toto importId už patrí inému obsahu. Pôvodný súbor sa nemení; pre nové zadanie použite nové importId.";
  if (error.message.includes("Recipe changed since editing"))
    return "Recept sa medzičasom zmenil. Obnovte náhľad a skontrolujte aktuálnu verziu.";
  if (error.message.includes("Recipe archived"))
    return "Recept je archivovaný; import ho neobnoví ani neprepíše.";
  return `Import zlyhal${error.code ? ` (${error.code})` : ""}: ${error.message.slice(0, 400)}`;
}

export function sourceKey(payload: unknown) {
  return stable(
    Array.isArray(payload)
      ? payload.map((r) => {
          const p = uploadedRecipeSchema.safeParse(r);
          return p.success ? p.data : r;
        })
      : payload,
  );
}
