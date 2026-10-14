import Link from "next/link";
import { requestTime } from "@/lib/time";
import { userDb } from "@/lib/supabase";
import { money, remainingValue } from "@/lib/domain";
export default async function Home() {
  const { client } = await userDb();
  const { data: packages, error } = await client
    .from("inventory_packages")
    .select("*")
    .gt("remaining_g", 0);
  if (error) throw new Error("Načítanie skladu zlyhalo. Overte migrácie.");
  const items = packages ?? [];
  const value =
    items.length && items.every((p) => p.cost_minor !== null)
      ? items.reduce((s, p) => s + remainingValue(p)!, 0)
      : null;
  const soon = items.filter(
    (p) =>
      p.best_before && Date.parse(p.best_before) < requestTime() + 7 * 86400000,
  ).length;
  return (
    <div className="stack">
      <div>
        <h1>Dobrý deň, čo si dáme?</h1>
        <p className="muted">Menej rozhodovania. Viac dobrého jedla.</p>
      </div>
      <section className="card hero">
        <span className="badge" style={{ color: "#20392e" }}>
          DNEŠNÝ VÝBER
        </span>
        <h2 style={{ marginTop: 20 }}>
          Dobré jedlo už možno čaká v mrazničke.
        </h2>
        <p>
          Vyberte zo svojich zásob podľa odporúčanej spotreby a posledných
          jedál.
        </p>
        <Link className="button" href="/surprise">
          🎲 Prekvap ma!
        </Link>
      </section>
      <div className="grid">
        <div className="card">
          <p className="muted">Dostupné balíčky</p>
          <div className="kpi">{items.length}</div>
        </div>
        <div className="card">
          <p className="muted">Čoskoro spotrebovať</p>
          <div className="kpi">{soon}</div>
        </div>
        <div className="card">
          <p className="muted">Hodnota zásob</p>
          <div className="kpi" style={{ fontSize: 26 }}>
            {money(value)}
          </div>
          <small>Pomerná hodnota zostávajúcej hmotnosti.</small>
        </div>
      </div>
      <section className="card">
        <h2>Vaša kuchyňa v pohybe</h2>
        <div className="row">
          <Link className="button" href="/recipes">
            Vytvoriť recept a várku
          </Link>
          <Link className="button" href="/inventory">
            Otvoriť mrazničku
          </Link>
        </div>
        {!items.length && (
          <p className="empty">
            Zatiaľ tu nie sú zásoby. Začnite receptom a uvarenou várkou.
          </p>
        )}
      </section>
    </div>
  );
}
