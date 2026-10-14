"use server";
import { userDb } from "@/lib/supabase";
import { moldSchema, cubeSchema, packagePlanSchema } from "@/lib/portioning";
import { parseCzk } from "@/lib/domain";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export async function addMold(form: FormData) {
  const parsed = moldSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/portioning?error=mold");
  const { client, user } = await userDb();
  const result = await client
    .from("portion_molds")
    .upsert(
      { ...parsed.data, user_id: user.id },
      { onConflict: "user_id,name,cells,cell_ml" },
    );
  if (result.error) redirect("/portioning?error=mold");
  revalidatePath("/portioning");
  redirect("/portioning?added=1");
}
export async function cubeOperation(
  form: FormData,
): Promise<{ message?: string; destination?: string }> {
  const { client } = await userDb();
  let payload;
  try {
    payload = JSON.parse(String(form.get("payload")));
  } catch {
    return { message: "Údaje sa nepodarilo načítať." };
  }
  const request = z.string().uuid().safeParse(form.get("request"));
  if (!request.success) return { message: "Obnovte formulár." };
  const kind = form.get("kind");
  let result;
  if (kind === "start") {
    const parsed = z
      .object({
        version: z.string().uuid(),
        weight: z.number().int().min(1).max(1000000),
        cost: z.string().max(20),
        made: z.iso.date(),
        quality: z.iso.date(),
        cubes: z.array(cubeSchema).min(1).max(200),
      })
      .safeParse(payload);
    if (!parsed.success)
      return { message: "Skontrolujte hmotnosti, objemy a dátumy." };
    let cost;
    try {
      cost = parseCzk(parsed.data.cost);
    } catch {
      return { message: "Zadajte platnú cenu alebo nechajte cenu prázdnu." };
    }
    result = await client.rpc("start_cube_batch", {
      p_id: request.data,
      p_version: parsed.data.version,
      p_weight: parsed.data.weight,
      p_cost: cost,
      p_made: parsed.data.made,
      p_quality: parsed.data.quality,
      p_cubes: parsed.data.cubes,
    });
  } else if (kind === "freeze") {
    const parsed = z
      .object({ batch: z.string().uuid(), frozen: z.iso.date() })
      .safeParse(payload);
    if (!parsed.success) return { message: "Vyberte platný dátum zmrazenia." };
    result = await client.rpc("freeze_cube_batch", {
      p_batch: parsed.data.batch,
      p_request: request.data,
      p_frozen: parsed.data.frozen,
    });
  } else if (kind === "pack") {
    const parsed = z
      .object({ batch: z.string().uuid(), packages: packagePlanSchema })
      .safeParse(payload);
    if (!parsed.success)
      return { message: "Skontrolujte balíčky, porcie a lokácie." };
    result = await client.rpc("pack_cube_batch", {
      p_batch: parsed.data.batch,
      p_request: request.data,
      p_packages: parsed.data.packages,
    });
  } else return { message: "Neplatná operácia." };
  if (result.error) {
    const text = result.error.message;
    return {
      message: text.includes("capacity")
        ? "Vybraná forma nemá dostatok voľných priehradiek. Zabaľte staršie zmrazené kocky alebo upravte výber foriem."
        : text.includes("balance")
          ? "Súčet hmotností musí zodpovedať celej várke. Každá kocka musí byť v práve jednom balíčku."
          : text.includes("already packed")
            ? "Várka už bola zabalená alebo ešte nie je zmrazená. Obnovte stránku."
            : text.includes("Duplicate")
              ? "Jedna kocka nemôže byť v dvoch balíčkoch."
              : "Operácia zlyhala. Skontrolujte údaje a aktiváciu novej databázovej migrácie.",
    };
  }
  revalidatePath("/", "layout");
  return { destination: kind === "pack" ? "/inventory" : "/portioning" };
}
