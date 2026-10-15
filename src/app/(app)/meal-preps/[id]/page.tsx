import { notFound } from "next/navigation";
import { z } from "zod";
import { planningData } from "@/lib/planning-server";
import { loadPrep } from "@/lib/meal-prep-server";
import { recipeRecord } from "@/lib/recipes";
import Project from "./project";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { client, recipes, latest } = await planningData();
  let state;
  try {
    state = await loadPrep(client, id);
  } catch {
    notFound();
  }
  const [pantry, aliases, versions, receipts, batches, batchLinks, packages] =
    await Promise.all([
      client.from("pantry_items").select("*"),
      client.from("ingredient_aliases").select("alias,canonical"),
      client.from("recipe_versions").select("*"),
      client
        .from("purchase_receipts")
        .select("id,total_minor,receipt_date")
        .eq("status", "confirmed"),
      client
        .from("cooking_batches")
        .select("id,recipe_version_id,weight_g,created_at"),
      client.from("meal_prep_batch_links").select("*").eq("project_id", id),
      client.from("inventory_packages").select("id,batch_id,name,remaining_g"),
    ]);
  for (const r of [
    pantry,
    aliases,
    versions,
    receipts,
    batches,
    batchLinks,
    packages,
  ])
    if (r.error) throw Error(r.error.message);
  const library = recipes.map((r) => ({
    ...recipeRecord(versions.data!.find((v) => v.id === r.id)),
    ...r,
  }));
  return (
    <Project
      key={state.project.revision}
      state={state}
      recipes={library}
      latest={latest.map((r) => r.id)}
      pantry={(pantry.data ?? []).map((p) => ({
        ...p,
        quantity: Number(p.quantity),
      }))}
      aliases={Object.fromEntries(
        (aliases.data ?? []).map((a) => [a.alias, a.canonical]),
      )}
      batches={batches.data ?? []}
      batchLinks={batchLinks.data ?? []}
      packages={packages.data ?? []}
      receipts={receipts.data ?? []}
    />
  );
}
