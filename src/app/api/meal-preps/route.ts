import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/supabase";
import { parsePrep, prepError } from "@/lib/meal-prep";
import {
  loadPrep,
  prepUpdate,
  prepUpdateSchema,
  prepCalendar,
} from "@/lib/meal-prep-server";
import { validateSchedule } from "@/lib/culinary-planning";
import { planningData } from "@/lib/planning-server";
import { randomUUID } from "node:crypto";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  let createdId: string | undefined;
  try {
    if (
      !req.headers.get("origin") ||
      new URL(req.headers.get("origin")!).host !== req.headers.get("host") ||
      req.headers.get("sec-fetch-site") === "cross-site"
    )
      return NextResponse.json(
        { error: "Neplatný pôvod požiadavky." },
        { status: 403 },
      );
    const client = await db();
    if (!(await client.auth.getUser()).data.user)
      return NextResponse.json(
        { error: "Prihláste sa znova." },
        { status: 401 },
      );
    const text = await req.text();
    if (text.length > 4000000) throw Error("Najviac 4 MB na projekt.");
    const raw = JSON.parse(text);
    const action = z
      .enum([
        "import",
        "preview",
        "save",
        "calendar_preview",
        "calendar",
        "batch",
      ])
      .parse(raw.action);
    if (action === "batch") {
      const data = z
        .object({
          request: z.string().uuid(),
          id: z.string().uuid(),
          row: z.string().uuid(),
          batch: z.string().uuid(),
          portions: z.number().positive().max(100),
        })
        .parse(raw);
      const result = await client.rpc("link_meal_prep_batch", {
        p_request: data.request,
        p_id: data.id,
        p_row: data.row,
        p_batch: data.batch,
        p_portions: data.portions,
      });
      if (result.error) throw Error(result.error.message);
      return NextResponse.json({ ok: true });
    }
    if (action === "import") {
      const doc = parsePrep(raw.document);
      const keys = z.array(z.string()).min(1).max(50).parse(raw.keys);
      if (
        new Set(keys).size !== keys.length ||
        keys.some((k) => !doc.recipes.some((r) => r.key === k))
      )
        throw Error("Neplatný výber receptov.");
      const reuse = z
        .record(z.string(), z.string().uuid())
        .parse(raw.reuse ?? {});
      const imported = await client.rpc("import_meal_prep", {
        p_document: doc,
        p_keys: keys,
        p_reuse: reuse,
      });
      if (imported.error) throw Error(imported.error.message);
      const id = String(imported.data);
      createdId = id;
      const state = await loadPrep(client, id);
      if (!state.project.initialised) {
        const calculated = await prepUpdate(client, {
          id,
          revision: state.project.revision,
          rows: state.rows.map((r) => ({
            id: r.id,
            local_key: r.local_key,
            recipe_version_id: r.recipe_version_id,
            portions: r.portions,
          })),
          status: "planned",
          manual: [],
          checks: {},
        });
        const result = await client.rpc("edit_meal_prep", {
          p_request: randomUUID(),
          p_id: id,
          p_revision: state.project.revision,
          p_rows: calculated.rows.map(
            ({ id, local_key, recipe_version_id, portions }) => ({
              id,
              local_key,
              recipe_version_id,
              portions,
            }),
          ),
          p_plan: calculated.plan,
          p_status: "planned",
        });
        if (result.error && !result.error.message.includes("REVISION_CONFLICT"))
          return NextResponse.json(
            {
              error:
                "Projekt bol vytvorený, ale nákup potrebuje obnoviť: " +
                result.error.message,
              id,
            },
            { status: 400 },
          );
      }
      return NextResponse.json({ ok: true, id });
    }
    if (action === "calendar_preview" || action === "calendar") {
      const id = z.string().uuid().parse(raw.id);
      const data = await prepCalendar(client, id);
      if (action === "calendar_preview")
        return NextResponse.json({
          meals: data.meals,
          batches: data.batches,
          conflicts: data.conflicts,
          applied: data.state.calendar.length > 0,
        });
      if (z.number().int().parse(raw.revision) !== data.state.project.revision)
        throw Error("REVISION_CONFLICT");
      if (data.conflicts.length) throw Error("CALENDAR_CONFLICT");
      const { recipes } = await planningData();
      validateSchedule(data.meals, data.batches, recipes);
      const result = await client.rpc("apply_meal_prep_calendar", {
        p_request: z.string().uuid().parse(raw.request),
        p_id: id,
        p_revision: raw.revision,
        p_changes: data.meals,
        p_batches: data.batches,
      });
      if (result.error) throw Error(result.error.message);
      return NextResponse.json({ ok: true });
    }
    const input = prepUpdateSchema.parse(raw.data);
    const data = await prepUpdate(client, input);
    if (action === "preview")
      return NextResponse.json({ plan: data.plan, conflicts: data.conflicts });
    const result = await client.rpc("edit_meal_prep", {
      p_request: z.string().uuid().parse(raw.request),
      p_id: input.id,
      p_revision: input.revision,
      p_rows: input.rows.sort((a, b) => a.id.localeCompare(b.id)),
      p_plan: data.plan,
      p_status: input.status,
    });
    if (result.error) throw Error(result.error.message);
    return NextResponse.json({ ok: true, conflicts: data.conflicts });
  } catch (e) {
    const detail = prepError(e);
    const error = detail.includes("REVISION_CONFLICT")
      ? "Projekt bol medzitým zmenený. Obnovte stránku."
      : detail.includes("SOURCE_CHANGED")
        ? "Rovnaké importId už obsahuje iný dokument. Pôvodný projekt zostal zachovaný."
        : detail.includes("DUPLICATE_REVIEW")
          ? "Recept s rovnakým názvom už existuje. Vyberte existujúcu verziu alebo ho vynechajte."
          : detail.includes("PGRST202") || detail.includes("schema cache")
            ? "Najprv aktivujte migráciu 011 po migrácii 010."
            : detail.includes("CALENDAR_ALREADY")
              ? "Tento projekt už bol pridaný do jedálnička. Upravte existujúci plán."
              : detail.includes("CALENDAR_CONFLICT")
                ? "Niektoré sloty sú obsadené. Existujúci jedálniček nebol zmenený."
                : detail.includes("PURCHASED_PROJECT_LOCKED")
                  ? "Po nákupe zostávajú recepty projektu uzamknuté. Vytvorte doplnkový meal prep."
                  : detail;
    return NextResponse.json(
      {
        error: createdId
          ? "Projekt je uložený; nákup treba dokončiť. " + error
          : error,
        id: createdId,
      },
      { status: 400 },
    );
  }
}
