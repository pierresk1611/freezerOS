"use server";
import seedRecipes from "../../../docs/seed-recipes.json";
import { userDb } from "@/lib/supabase";
import { recipeSchema, importSchema, parseCzk } from "@/lib/domain";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
async function rpc(name: string, args: Record<string, unknown>, path: string) {
  const { client } = await userDb();
  const { error } = await client.rpc(name, args);
  if (error) redirect(path + "?error=operation");
  revalidatePath("/", "layout");
  redirect(path);
}
export async function createRecipe(form: FormData) {
  let ingredients, steps;
  try {
    ingredients = JSON.parse(String(form.get("ingredients")));
    steps = String(form.get("steps")).split("\n").filter(Boolean);
  } catch {
    redirect("/recipes?error=validation");
  }
  const parsed = recipeSchema.safeParse({
    name: form.get("name"),
    portions: Number(form.get("portions")),
    ingredients,
    steps,
    reheating: form.get("reheating"),
    storage: form.get("storage") ?? undefined,
    meat: form.get("meat") ?? undefined,
    freezing: form.has("freezing")
      ? form.get("freezing") === "true"
      : undefined,
  });
  if (!parsed.success) redirect("/recipes?error=validation");
  if (form.get("version_id")) {
    const id = z.string().uuid().safeParse(form.get("version_id"));
    if (!id.success) redirect("/recipes?error=validation");
    await rpc(
      "revise_recipe",
      {
        p_version_id: id.data,
        p_request_id: form.get("request_id"),
        p_recipe: parsed.data,
      },
      "/recipes",
    );
  }
  await rpc(
    "import_recipes",
    { p_import_id: form.get("request_id"), p_recipes: [parsed.data] },
    "/recipes",
  );
}
export async function importRecipes(form: FormData) {
  let raw;
  try {
    raw = JSON.parse(String(form.get("json")));
  } catch {
    redirect("/recipes?error=validation");
  }
  const parsed = importSchema.safeParse(raw);
  if (!parsed.success) redirect("/recipes?error=validation");
  await rpc(
    "import_recipes",
    { p_import_id: parsed.data.importId, p_recipes: parsed.data.payload },
    "/recipes",
  );
}
export async function cook(form: FormData) {
  const schema = z.object({
    version_id: z.string().uuid(),
    request_id: z.string().uuid(),
    weight: z.coerce.number().int().positive().max(1000000),
    packages: z.coerce.number().int().positive().max(100),
    cost: z.string().max(20),
    best_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const p = schema.safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/recipes?error=validation");
  let cost: number | null;
  try {
    cost = parseCzk(p.data.cost);
  } catch {
    redirect("/recipes?error=validation");
  }
  await rpc(
    "create_batch",
    {
      p_version_id: p.data.version_id,
      p_request_id: p.data.request_id,
      p_weight_g: p.data.weight,
      p_package_count: p.data.packages,
      p_cost_minor: cost,
      p_best_before: p.data.best_before,
    },
    "/inventory",
  );
}
export async function consume(form: FormData) {
  const p = z
    .object({
      package_id: z.string().uuid(),
      request_id: z.string().uuid(),
      grams: z.coerce.number().int().positive(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/inventory?error=validation");
  await rpc(
    "consume_package",
    {
      p_package_id: p.data.package_id,
      p_request_id: p.data.request_id,
      p_grams: p.data.grams,
    },
    "/inventory",
  );
}
export async function move(form: FormData) {
  const p = z
    .object({
      package_id: z.string().uuid(),
      request_id: z.string().uuid(),
      location_id: z.string().uuid(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/inventory?error=validation");
  await rpc(
    "move_package",
    {
      p_package_id: p.data.package_id,
      p_request_id: p.data.request_id,
      p_location_id: p.data.location_id,
    },
    "/inventory",
  );
}
export async function addLocation(form: FormData) {
  const name = z.string().trim().min(1).max(100).safeParse(form.get("name"));
  if (!name.success) redirect("/inventory?error=validation");
  const { client, user } = await userDb();
  const { error } = await client
    .from("storage_locations")
    .insert({ user_id: user.id, name: name.data });
  if (error) redirect("/inventory?error=operation");
  revalidatePath("/inventory");
  redirect("/inventory");
}

export async function archiveRecipe(form: FormData) {
  const parsed = z
    .object({ recipe_id: z.string().uuid(), request_id: z.string().uuid() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/recipes?error=validation");
  await rpc(
    "archive_recipe",
    {
      p_recipe_id: parsed.data.recipe_id,
      p_request_id: parsed.data.request_id,
    },
    "/recipes",
  );
}
export async function importDefaults() {
  const data = importSchema.parse(seedRecipes);
  const { client } = await userDb();
  const { data: existing, error } = await client
    .from("operation_requests")
    .select("id")
    .eq("id", data.importId)
    .maybeSingle();
  if (error) redirect("/recipes?error=operation");
  if (existing) redirect("/recipes/corrections");
  await rpc(
    "import_recipes",
    { p_import_id: data.importId, p_recipes: data.payload },
    "/recipes",
  );
}
