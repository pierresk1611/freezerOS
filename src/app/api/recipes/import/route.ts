import { db } from "@/lib/supabase";
import {
  normalizeFiles,
  uploadedRecipeSchema,
  importError,
  stable,
  type ImportResult,
} from "@/lib/recipe-import";
import { importState } from "@/lib/recipe-import-server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  let origin = "";
  try {
    origin = new URL(request.headers.get("origin") ?? "").host;
  } catch {}
  if (
    !origin ||
    origin !== request.headers.get("host") ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return Response.json(
      { error: "Neplatný pôvod požiadavky." },
      { status: 403 },
    );
  const client = await db();
  if (!(await client.auth.getUser()).data.user)
    return Response.json({ error: "Prihláste sa znova." }, { status: 401 });
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2500000)
      throw new Error("Súbory spolu môžu mať najviac 2 MB.");
    const body = JSON.parse(raw);
    const files = normalizeFiles(body.files);
    if (body.action === "preview")
      return Response.json(await importState(client, files), {
        headers: { "Cache-Control": "no-store" },
      });
    if (body.action !== "apply") throw new Error("Neplatná akcia.");
    const choices = z
      .array(
        z.object({
          key: z.string(),
          file: z.number().int().min(0),
          index: z.number().int().min(0),
          mode: z.enum(["new", "version"]),
          target: z.string().uuid().nullable(),
          confirmed: z.boolean(),
        }),
      )
      .min(1)
      .max(20)
      .parse(body.choices);
    const results: ImportResult[] = [];
    for (const c of choices) {
      const f = files[c.file];
      if (!f || c.key !== `${c.file}:${c.index}` || !f.data.payload[c.index])
        throw new Error("Neplatný výber receptu.");
      if (
        files.some(
          (other) =>
            other.data.importId === f.data.importId &&
            stable(other.data.payload) !== stable(f.data.payload),
        )
      ) {
        results.push({
          key: c.key,
          name: `Recept ${c.index + 1}`,
          status: "error",
          reason: "Rovnaké importId má v súboroch rozdielny obsah.",
        });
        continue;
      }
      const p = uploadedRecipeSchema.safeParse(f.data.payload[c.index]);
      if (!p.success) {
        results.push({
          key: c.key,
          name: `Recept ${c.index + 1}`,
          status: "error",
          reason: "Neplatný recept podľa schémy 1.0.",
        });
        continue;
      }
      if (c.mode === "version" && (!c.target || !c.confirmed)) {
        results.push({
          key: c.key,
          name: p.data.name,
          status: "error",
          reason:
            "Nová verzia vyžaduje výslovné potvrdenie a výber cieľového receptu.",
        });
        continue;
      }
      const r = await client.rpc("import_recipe_item", {
        p_import_id: f.data.importId,
        p_payload: f.data.payload,
        p_index: c.index,
        p_mode: c.mode,
        p_target: c.target,
      });
      results.push(
        r.error
          ? {
              key: c.key,
              name: p.data.name,
              status: "error",
              reason: importError(r.error),
            }
          : {
              key: c.key,
              name: p.data.name,
              ...r.data,
              reason:
                (
                  {
                    already: "Recept z tohto súboru už bol spracovaný.",
                    existing:
                      "Existuje recept so zhodným názvom alebo obsahom.",
                    archived: "Zhodný recept je archivovaný; nebol obnovený.",
                  } as Record<string, string>
                )[r.data?.reason] ?? r.data?.reason,
            },
      );
    }
    revalidatePath("/recipes");
    revalidatePath("/recipes/pulled");
    return Response.json(
      { results },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? "Skontrolujte obálku FREEZER OS 1.0, importId a výber súborov."
            : e instanceof Error
              ? e.message
              : "Import zlyhal.",
      },
      { status: 400 },
    );
  }
}
