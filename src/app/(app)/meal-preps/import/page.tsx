import { userDb } from "@/lib/supabase";
import { contentKey } from "@/lib/recipe-import";
import Importer from "./importer";
export default async function Page() {
  const { client } = await userDb();
  const [versions, roots, ready] = await Promise.all([
    client.from("recipe_versions").select("*"),
    client.from("recipes").select("id,archived"),
    client.from("meal_prep_projects").select("id").limit(0),
  ]);
  if (versions.error || roots.error)
    throw Error("Recepty sa nepodarilo načítať.");
  return (
    <Importer
      ready={!ready.error}
      existing={(versions.data ?? [])
        .filter((v) =>
          roots.data?.some((r) => r.id === v.recipe_id && !r.archived),
        )
        .map((v) => ({
          id: v.id,
          name: v.name,
          key: contentKey({
            ...v,
            metadata: {
              ...v.metadata,
              meal_role: undefined,
              allowed_slots: undefined,
              side_policy: undefined,
              compatible_side_ids: undefined,
            },
          }),
        }))}
    />
  );
}
