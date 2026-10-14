import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { loadRecipePhotos } from "@/lib/recipe-photos";
import {
  photoFileError,
  photoOrderSchema,
  PHOTO_BYTES,
} from "@/lib/photo-rules";
import { optimizePhoto } from "@/lib/photo-processing";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
export const runtime = "nodejs";
const error = (message: string, status = 400) =>
  NextResponse.json(
    { message },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
async function authorize(
  request: NextRequest,
  params: Promise<{ id: string }>,
  mutation = false,
) {
  if (mutation) {
    let sameOrigin = false;
    try {
      const origin = new URL(request.headers.get("origin") ?? "");
      sameOrigin =
        origin.host === request.headers.get("host") &&
        ["https:", "http:"].includes(origin.protocol) &&
        request.headers.get("sec-fetch-site") !== "cross-site";
    } catch {}
    if (!sameOrigin)
      return { failure: error("Neplatný pôvod požiadavky.", 403) };
  }
  const id = (await params).id;
  if (!z.string().uuid().safeParse(id).success)
    return { failure: error("Recept neexistuje.", 404) };
  const client = await db();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { failure: error("Prihláste sa znova.", 401) };
  const { data: recipe, error: failure } = await client
    .from("recipes")
    .select("id,photo_revision")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("archived", false)
    .maybeSingle();
  if (failure)
    return {
      failure: error(
        "Fotografie nie sú dostupné. Skontrolujte databázovú migráciu.",
        503,
      ),
    };
  if (!recipe) return { failure: error("Recept neexistuje.", 404) };
  return { client, user, recipe, id };
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authorize(request, params);
  if (ctx.failure) return ctx.failure;
  try {
    return NextResponse.json(
      {
        photos:
          (await loadRecipePhotos(ctx.client, [ctx.id])).get(ctx.id) ?? [],
        revision: ctx.recipe.photo_revision,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return error("Fotografie sa nepodarilo načítať.", 503);
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authorize(request, params, true);
  if (ctx.failure) return ctx.failure;
  if (Number(request.headers.get("content-length")) > PHOTO_BYTES + 65536)
    return error("Fotografia môže mať najviac 10 MB.", 413);
  let form;
  try {
    form = await request.formData();
  } catch {
    return error("Neplatný súbor.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return error("Vyberte fotografiu.");
  const invalid = photoFileError(file.size, file.type);
  if (invalid) return error(invalid);
  const alt = z.string().trim().min(1).max(300).safeParse(form.get("alt"));
  if (!alt.success) return error("Zadajte popis fotografie (1 až 300 znakov).");
  let optimized;
  try {
    optimized = await optimizePhoto(Buffer.from(await file.arrayBuffer()));
  } catch {
    return error(
      "Fotografia je poškodená, príliš veľká alebo v nepodporovanom formáte.",
    );
  }
  const id = randomUUID(),
    base = `${ctx.user.id}/${ctx.id}/${id}/`;
  const paths = [base + "large.webp", base + "thumb.webp"];
  const storage = ctx.client.storage.from("recipe-photos");
  for (const [i, bytes] of [optimized.large, optimized.thumbnail].entries()) {
    const uploaded = await storage.upload(paths[i], bytes, {
      contentType: "image/webp",
      upsert: false,
    });
    if (uploaded.error) {
      await storage.remove(paths);
      return error(
        "Nahratie zlyhalo. Skontrolujte úložisko a skúste znova.",
        503,
      );
    }
  }
  const added = await ctx.client.rpc("add_recipe_photo", {
    p_recipe: ctx.id,
    p_id: id,
    p_alt: alt.data,
  });
  if (added.error) {
    await storage.remove(paths);
    return error(
      added.error.message.includes("limit")
        ? "Recept môže mať najviac 8 fotografií."
        : "Fotografiu sa nepodarilo uložiť. Skúste znova.",
      409,
    );
  }
  revalidatePath("/recipes", "layout");
  return NextResponse.json({ id });
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authorize(request, params, true);
  if (ctx.failure) return ctx.failure;
  let parsed;
  try {
    parsed = photoOrderSchema.safeParse(await request.json());
  } catch {
    return error("Neplatné údaje.");
  }
  if (!parsed.success) return error("Skontrolujte popisy fotografií.");
  const before = await ctx.client
    .from("recipe_photos")
    .select("id,storage_path,thumbnail_path")
    .eq("recipe_id", ctx.id);
  if (before.error) return error("Fotografie nie sú dostupné.", 503);
  const saved = await ctx.client.rpc("save_recipe_photos", {
    p_recipe: ctx.id,
    p_revision: parsed.data.revision,
    p_photos: parsed.data.photos,
  });
  if (saved.error)
    return error(
      saved.error.message.includes("changed")
        ? "Fotografie sa medzitým zmenili. Obnovte stránku."
        : "Zmeny sa nepodarilo uložiť.",
      409,
    );
  const removed = (before.data ?? [])
    .filter((p) => !parsed.data.photos.some((q) => q.id === p.id))
    .flatMap((p) => [p.storage_path, p.thumbnail_path]);
  let cleanupWarning = false;
  if (removed.length) {
    const cleanup = await ctx.client.storage
      .from("recipe-photos")
      .remove(removed);
    cleanupWarning = !!cleanup.error;
  }
  revalidatePath("/recipes", "layout");
  return NextResponse.json({ ok: true, cleanupWarning });
}
