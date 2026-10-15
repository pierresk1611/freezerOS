import { planningData } from "@/lib/planning-server";
import { recipeRecord } from "@/lib/recipes";
import { roleProposal } from "@/lib/role-proposals";
import Roles from "./roles";
import "../planner.css";
export default async function Page() {
  const { client, latest } = await planningData();
  const { data, error } = await client.from("recipe_versions").select("*");
  if (error) throw Error(error.message);
  const ready = await client.from("meal_plan_components").select("id").limit(0);
  return (
    <Roles
      ready={!ready.error}
      recipes={latest.map((r) => ({
        ...r,
        proposal: roleProposal(recipeRecord(data!.find((v) => v.id === r.id))),
      }))}
    />
  );
}
