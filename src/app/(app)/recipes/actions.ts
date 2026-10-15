"use server";
import { userDb } from "@/lib/supabase";
import { recipeSchema } from "@/lib/domain";
import { z } from "zod";
import { revalidatePath } from "next/cache";

export type SaveResult = {
  destination?: string;
  recipeId?: string;
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
  if (
    parsed.data.cooking_minutes_min &&
    parsed.data.cooking_minutes_max &&
    parsed.data.cooking_minutes_min > parsed.data.cooking_minutes_max
  )
    return { message: "Začiatočný čas pečenia nemôže byť väčší než konečný." };
  if (parsed.data.meal_role && parsed.data.meal_role !== "unknown") {
    if (!parsed.data.allowed_slots?.length)
      return { message: "Vyberte povolené jedlá dňa." };
    const ready = await client
      .from("meal_plan_components")
      .select("id")
      .limit(0);
    if (ready.error)
      return { message: "Pre uloženie roly najprv aktivujte migráciu 010." };
  }
  const request = z.string().uuid().safeParse(form.get("request_id"));
  if (!request.success)
    return { message: "Platnosť formulára vypršala. Obnovte stránku." };
  const version = form.get("version_id");
  let destination = "/recipes?created=1";
  let recipeId: string | undefined = request.data;
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
    recipeId = source.recipe_id;
    destination = "/recipes/" + source.recipe_id + "?saved=1";
  } else {
    const result = await client.rpc("create_recipe_with_id", {
      p_id: request.data,
      p_recipe: parsed.data,
    });
    if (result.error?.code === "PGRST202") {
      if (form.get("has_photos") === "true")
        return {
          message:
            "Najprv aktivujte SQL migráciu fotografií. Recept ani fotografie ešte neboli uložené.",
        };
      const legacy = await client.rpc("import_recipes", {
        p_import_id: request.data,
        p_recipes: [parsed.data],
      });
      if (legacy.error)
        return { message: "Uloženie sa nepodarilo. Skúste znova." };
      recipeId = undefined;
    } else if (result.error)
      return {
        message:
          "Uloženie sa nepodarilo. Skontrolujte pripojenie a skúste znova.",
      };
  }
  revalidatePath("/", "layout");
  return { destination, recipeId };
}
