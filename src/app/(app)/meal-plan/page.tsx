import { planningData } from "@/lib/planning-server";
import { monday, pragueToday, addDays, daySchema } from "@/lib/planning";
import Planner from "./planner";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const p = await searchParams;
  const start = monday(
    daySchema.safeParse(p.week).success ? p.week! : pragueToday(),
  );
  const { client, recipes, latest, available, recent, quality } =
    await planningData();
  const entries = await client
    .from("meal_plan_entries")
    .select("*")
    .gte("meal_date", start)
    .lte("meal_date", addDays(start, 6));
  if (entries.error) throw Error(entries.error.message);
  const ready = await client.from("shopping_plans").select("id").limit(1);
  const settings = await client
    .from("planner_settings")
    .select("settings,revision")
    .maybeSingle();
  const previous = await client
    .from("meal_plan_entries")
    .select("*")
    .gte("meal_date", addDays(start, -7))
    .lte("meal_date", addDays(start, -1));
  return (
    <Planner
      start={start}
      initial={entries.data ?? []}
      recipes={recipes}
      latest={latest}
      available={available}
      quality={quality}
      recent={recent}
      ready={!ready.error}
      settings={{
        ...settings.data?.settings,
        revision: settings.data?.revision,
      }}
      previous={previous.data ?? []}
    />
  );
}
