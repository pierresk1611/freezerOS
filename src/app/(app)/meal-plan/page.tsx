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
  const [entries, components, batches, links, settings] = await Promise.all([
    client
      .from("meal_plan_entries")
      .select("*")
      .gte("meal_date", addDays(start, -7))
      .lte("meal_date", addDays(start, 6)),
    client.from("meal_plan_components").select("*").order("position"),
    client.from("planned_cooking_batches").select("*"),
    client.from("shopping_plan_recipes").select("meal_entry_id"),
    client.from("planner_settings").select("settings").maybeSingle(),
  ]);
  if (entries.error) throw Error(entries.error.message);
  if (settings.error && !components.error)
    throw Error("Nastavenia obmedzení sa nepodarilo načítať. Skúste znova.");
  const hardBans: unknown = settings.data?.settings?.banned;
  if (
    hardBans !== undefined &&
    (!Array.isArray(hardBans) || hardBans.some((b) => typeof b !== "string"))
  )
    throw Error("Skontrolujte uložené obmedzenia plánovača.");
  const meals = (entries.data ?? []).map((e) => ({
    ...e,
    components: (components.data ?? []).filter((c) => c.entry_id === e.id),
  }));
  return (
    <Planner
      hardBans={(hardBans ?? []) as string[]}
      start={start}
      initial={meals.filter((e) => e.meal_date >= start)}
      previous={meals.filter((e) => e.meal_date < start)}
      batches={batches.data ?? []}
      recipes={recipes}
      latest={latest}
      available={available}
      quality={quality}
      recent={recent}
      ready={!components.error && !batches.error}
      linked={(links.data ?? []).flatMap((l) =>
        l.meal_entry_id ? [l.meal_entry_id] : [],
      )}
    />
  );
}
