"use server";
import plan from "../../../../../docs/seed-corrections/storage-reheating-v1.json";
import { canCorrect } from "@/lib/seed-corrections.mjs";
import { userDb } from "@/lib/supabase";
import { recipeSchema } from "@/lib/domain";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
export async function correctSeedGuidance(form: FormData) {
  const { client } = await userDb();
  const parsed = z
    .object({
      version_id: z.string().uuid(),
      request_id: z.string().uuid(),
      key: z.string().max(160),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/recipes/corrections?error=invalid");
  const item = plan.items.find((i) => i.key === parsed.data.key);
  if (!item) redirect("/recipes/corrections?error=invalid");
  const { data: row, error } = await client
    .from("recipe_versions")
    .select("*")
    .eq("id", parsed.data.version_id)
    .maybeSingle();
  if (error || !row || !canCorrect(row, item))
    redirect("/recipes/corrections?error=changed");
  // Preserve all supported recipe fields; replace ONLY the two reviewed guidance fields.
  const payload = recipeSchema.parse({
    ...row,
    storage: item.after.storage,
    reheating: item.after.reheating,
  });
  const result = await client.rpc("revise_recipe", {
    p_version_id: row.id,
    p_request_id: parsed.data.request_id,
    p_recipe: payload,
  });
  if (result.error) redirect("/recipes/corrections?error=changed");
  revalidatePath("/", "layout");
  redirect("/recipes/corrections?saved=1");
}
