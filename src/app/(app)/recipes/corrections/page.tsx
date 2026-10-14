import Link from "next/link";
import { randomUUID } from "node:crypto";
import { ArrowLeft } from "lucide-react";
import plan from "../../../../../docs/seed-corrections/storage-reheating-v1.json";
import { correctionStatus } from "@/lib/seed-corrections.mjs";
import { userDb } from "@/lib/supabase";
import { correctSeedGuidance } from "./actions";
export default async function Corrections({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const { client } = await userDb();
  const [{ data: latest, error }, { data: first, error: firstError }] =
    await Promise.all([
      client.from("recipe_latest").select("*"),
      client.from("recipe_versions").select("recipe_id,name").eq("version", 1),
    ]);
  if (error || firstError) throw error ?? firstError;
  const items = (latest ?? []).flatMap((row) => {
    const original = first?.find((v) => v.recipe_id === row.recipe_id);
    const item = plan.items.find((i) => i.key === original?.name);
    if (!item) return [];
    const status = correctionStatus(row, item);
    return status === "corrected" ? [] : [{ row, item, status }];
  });
  return (
    <div className="recipe-page recipe-editor-page">
      <Link className="back-link" href="/recipes/import">
        <ArrowLeft size={18} />
        Späť na import
      </Link>
      <h1>Oprava pokynov receptov</h1>
      <p className="muted">
        Skontrolujte skladovanie a zohrievanie pôvodných šablón. Nič sa nemení
        bez vášho potvrdenia. Oprava vytvorí novú verziu; historické várky si
        zachovajú pôvodné väzby.
      </p>
      {params.saved && (
        <p className="recipe-notice" role="status">
          Oprava bola uložená ako nová verzia.
        </p>
      )}
      {params.error && (
        <p className="recipe-form-alert" role="alert">
          Recept sa medzitým zmenil alebo oprava zlyhala. Obnovte stránku a
          skontrolujte aktuálnu verziu; upravený obsah sa automaticky
          neprepisuje.
        </p>
      )}
      {!items.length && (
        <section className="card">
          <h2>Žiadne rozpoznané šablóny nevyžadujú opravu</h2>
          <p>
            Nové importy už obsahujú opravené pokyny. Vlastné recepty
            kontrolujte individuálne.
          </p>
        </section>
      )}
      <div className="stack">
        {items.map(({ row, item, status }) => (
          <section className="card" key={row.id}>
            <h2>{row.name}</h2>
            <span className="badge">
              {status === "eligible"
                ? "Nezmenená pôvodná šablóna"
                : "Používateľsky upravený recept — individuálna kontrola"}
            </span>
            <h3>Aktuálne skladovanie</h3>
            <p>{row.storage}</p>
            <h3>Navrhované skladovanie pôvodnej šablóny</h3>
            <p>{item.after.storage}</p>
            <h3>Aktuálne zohrievanie</h3>
            <p>{row.reheating}</p>
            <h3>Navrhované zohrievanie pôvodnej šablóny</h3>
            <p>{item.after.reheating}</p>
            {status === "eligible" ? (
              <form action={correctSeedGuidance}>
                <input type="hidden" name="version_id" value={row.id} />
                <input type="hidden" name="request_id" value={randomUUID()} />
                <input type="hidden" name="key" value={item.key} />
                <button>Potvrdiť opravu ako novú verziu</button>
              </form>
            ) : (
              <>
                <p className="recipe-form-alert">
                  Návrh platí pre pôvodné suroviny a prípravu. Pri ich zmene
                  pokyny prispôsobte. Tento recept sa tu nedá automaticky
                  opraviť.
                </p>
                <Link
                  className="button button-secondary"
                  href={"/recipes/" + row.recipe_id + "/edit"}
                >
                  Skontrolovať a upraviť individuálne
                </Link>
              </>
            )}
          </section>
        ))}
      </div>
      <p className="muted">
        Staré verzie zostávajú auditovateľné, ale môžu obsahovať nesprávne
        pokyny. Pre existujúcu várku posúďte odporúčania podľa jej skutočného
        zloženia, prípravy a histórie chladenia. Oprava textu neurobí nesprávne
        skladované jedlo bezpečným.
      </p>
    </div>
  );
}
