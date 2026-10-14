"use server";
import { userDb } from "@/lib/supabase";
import { recipeSchema } from "@/lib/domain";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export type SaveResult = {
  message?: string;
  fields?: Record<string, string[]>;
};
export async function saveRecipe(form: FormData): Promise<SaveResult> {
  const { client } = await userDb();
  let raw;
  try {
    raw = JSON.parse(String(form.get("payload")));
  } catch {
    return {
      message: "Údaje sa nepodarilo prečítať. Skúste ich uložiť znova.",
    };
  }
  const parsed = recipeSchema.safeParse(raw);
  if (!parsed.success)
    return {
      message: "Skontrolujte označené polia.",
      fields: z.flattenError(parsed.error).fieldErrors,
    };
  const request = z.string().uuid().safeParse(form.get("request_id"));
  if (!request.success)
    return { message: "Platnosť formulára vypršala. Obnovte stránku." };
  const version = form.get("version_id");
  let destination = "/recipes?created=1";
  if (version) {
    const valid = z.string().uuid().safeParse(version);
    if (!valid.success) return { message: "Neplatná verzia receptu." };
    const { data: source, error } = await client
      .from("recipe_versions")
      .select("recipe_id")
      .eq("id", valid.data)
      .maybeSingle();
    if (error || !source)
      return { message: "Recept nie je dostupný. Obnovte stránku." };
    const result = await client.rpc("revise_recipe", {
      p_version_id: valid.data,
      p_request_id: request.data,
      p_recipe: parsed.data,
    });
    if (result.error)
      return {
        message: result.error.message.includes("changed since editing")
          ? "Recept medzitým upravil iný používateľ alebo karta. Otvorte aktuálnu verziu; vaše úpravy zatiaľ zostávajú v tomto formulári."
          : "Uloženie sa nepodarilo. Vaše úpravy zostávajú vo formulári; skontrolujte pripojenie a skúste znova.",
      };
    destination = "/recipes/" + source.recipe_id + "?saved=1";
  } else {
    const result = await client.rpc("import_recipes", {
      p_import_id: request.data,
      p_recipes: [parsed.data],
    });
    if (result.error)
      return {
        message:
          "Uloženie sa nepodarilo. Skontrolujte pripojenie a skúste znova.",
      };
  }
  revalidatePath("/", "layout");
  redirect(destination);
}
