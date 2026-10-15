"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  mealRoles,
  defaultSlots,
  isSideRole,
  type MealRole,
} from "@/lib/meal-roles";
import type { PlanningRecipe } from "@/lib/planning";
type Row = PlanningRecipe & {
  proposal?: { role: MealRole; side_policy: "none" | "optional" };
};
export default function Roles({
  recipes,
  ready,
}: {
  recipes: Row[];
  ready: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(
    recipes.map((r) => ({
      ...r,
      choice:
        r.meal_role === "unknown"
          ? (r.proposal?.role ?? "unknown")
          : (r.meal_role ?? "unknown"),
      policy:
        r.side_policy === "none" && r.meal_role === "unknown"
          ? (r.proposal?.side_policy ?? "none")
          : (r.side_policy ?? "none"),
      slots: r.allowed_slots?.length
        ? r.allowed_slots
        : [...defaultSlots(r.proposal?.role ?? r.meal_role ?? "unknown")],
      sides: r.compatible_side_ids ?? [],
      selected: false,
    })),
  );
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/planning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: crypto.randomUUID(),
          action: "roles",
          data: rows
            .filter((r) => r.selected)
            .map((r) => ({
              version_id: r.id,
              meal_role: r.choice,
              allowed_slots: r.slots,
              side_policy: r.choice === "main" ? r.policy : "none",
              compatible_side_ids: r.choice === "main" ? r.sides : [],
            })),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(
        "Roly uložené ako nové verzie. Historické recepty a várky zostali zachované.",
      );
      router.refresh();
      setRows((p) =>
        p.map((r) => ({
          ...r,
          id: r.selected
            ? (d.roleVersions?.find(
                (v: { id: string; recipe_id: string }) =>
                  v.recipe_id === r.recipe_id,
              )?.id ?? r.id)
            : r.id,
          selected: false,
        })),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Uloženie zlyhalo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="culinary">
      <Link href="/meal-plan">← Jedálniček</Link>
      <h1>Čo je hlavné jedlo a čo príloha?</h1>
      <p>
        Návrhy sú pripravené iba pre rozpoznané pôvodné šablóny podľa ich
        surovín a postupu. Skontrolujte každý výber. Nezatriedené recepty sa
        automaticky neplánujú.
      </p>
      {!ready && <p role="alert">Najprv aktivujte migráciu 010.</p>}
      <p role="status">{message}</p>
      {rows.map((r, i) => (
        <article className="card" key={r.id}>
          <label>
            <input
              type="checkbox"
              checked={r.selected}
              onChange={(e) =>
                setRows((p) =>
                  p.map((r, j) =>
                    j === i ? { ...r, selected: e.target.checked } : r,
                  ),
                )
              }
            />{" "}
            Potvrdiť zatriedenie: <strong>{r.name}</strong>
          </label>
          <p>
            {r.proposal
              ? "Návrh podľa pôvodnej šablóny; potvrďte alebo opravte."
              : "Vlastný recept — vyberte rolu podľa skutočného obsahu."}
          </p>
          <label>
            Rola
            <select
              value={r.choice}
              onChange={(e) =>
                setRows((p) =>
                  p.map((r, j) =>
                    j === i
                      ? {
                          ...r,
                          choice: e.target.value as MealRole,
                          slots: [...defaultSlots(e.target.value as MealRole)],
                        }
                      : r,
                  ),
                )
              }
            >
              {Object.entries(mealRoles).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Povolené sloty</legend>
            {[
              ["breakfast", "Raňajky"],
              ["lunch", "Obed"],
              ["dinner", "Večera"],
              ["snack", "Snack"],
            ].map(([v, l]) => (
              <label key={v}>
                <input
                  type="checkbox"
                  checked={r.slots.includes(v)}
                  onChange={(e) =>
                    setRows((p) =>
                      p.map((r, j) =>
                        j === i
                          ? {
                              ...r,
                              slots: e.target.checked
                                ? [...r.slots, v]
                                : r.slots.filter((s) => s !== v),
                            }
                          : r,
                      ),
                    )
                  }
                />
                {l}
              </label>
            ))}
          </fieldset>
          {r.choice === "main" && (
            <>
              <label>
                Prílohy
                <select
                  value={r.policy}
                  onChange={(e) =>
                    setRows((p) =>
                      p.map((r, j) =>
                        j === i
                          ? {
                              ...r,
                              policy: e.target.value as
                                "none" | "optional" | "required",
                            }
                          : r,
                      ),
                    )
                  }
                >
                  <option value="none">
                    Bez prílohy / príloha už je v recepte
                  </option>
                  <option value="optional">Voliteľná príloha</option>
                  <option value="required">Vyžaduje prílohu</option>
                </select>
              </label>
              {r.policy !== "none" && (
                <fieldset>
                  <legend>
                    Kompatibilné prílohy — potvrďte vhodné kombinácie
                  </legend>
                  {rows
                    .filter(
                      (s) =>
                        s.recipe_id !== r.recipe_id && isSideRole(s.choice),
                    )
                    .map((s) => (
                      <label key={s.id}>
                        <input
                          type="checkbox"
                          checked={r.sides.includes(s.recipe_id)}
                          onChange={(e) =>
                            setRows((p) =>
                              p.map((r, j) =>
                                j === i
                                  ? {
                                      ...r,
                                      sides: e.target.checked
                                        ? [...r.sides, s.recipe_id]
                                        : r.sides.filter(
                                            (id) => id !== s.recipe_id,
                                          ),
                                    }
                                  : r,
                              ),
                            )
                          }
                        />
                        {s.name}
                      </label>
                    ))}
                </fieldset>
              )}
            </>
          )}
        </article>
      ))}
      <button
        disabled={!ready || busy || !rows.some((r) => r.selected)}
        onClick={save}
      >
        Potvrdiť vybrané roly — uložiť nové verzie
      </button>
    </section>
  );
}
