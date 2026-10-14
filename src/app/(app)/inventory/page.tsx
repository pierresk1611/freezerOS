import { userDb } from "@/lib/supabase";
import { money, remainingValue } from "@/lib/domain";
import { consume, move, addLocation } from "../actions";
import { randomUUID } from "crypto";
export default async function Inventory({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; id?: string }>;
}) {
  const params = await searchParams;
  const { client } = await userDb();
  const [{ data: items, error }, { data: locations, error: locationError }] =
    await Promise.all([
      client
        .from("inventory_packages")
        .select("*")
        .gt("remaining_g", 0)
        .order("best_before"),
      client.from("storage_locations").select("*"),
    ]);
  if (error || locationError) throw error || locationError;
  return (
    <div className="stack">
      <h1>Moja mraznička</h1>
      {params.error && (
        <p role="alert" className="error">
          Operácia zlyhala. Skontrolujte dostupné množstvo a pripojenie.
        </p>
      )}
      <details className="card">
        <summary>+ Skladová pozícia</summary>
        <form action={addLocation}>
          <label>
            Názov lokácie
            <input
              name="name"
              required
              placeholder="Mraznička 1 → Zásuvka 2 → Box A"
            />
          </label>
          <button>Pridať</button>
        </form>
      </details>
      <div className="grid">
        {items
          ?.filter((p) => !params.id || p.id === params.id)
          .map((p) => (
            <article className="card" key={p.id}>
              <span className="badge">Zmrazené</span>
              <h2 style={{ marginTop: 16 }}>{p.name}</h2>
              <p>
                <strong>{p.remaining_g} g</strong> z {p.initial_g} g
              </p>
              <p className="muted">
                {locations?.find((l) => l.id === p.location_id)?.name ??
                  "Bez umiestnenia"}
                <br />
                Odporúčaná spotreba: {p.best_before ?? "Neznáma"}
              </p>
              <p>{money(p.cost_minor === null ? null : remainingValue(p)!)}</p>
              <details>
                <summary>Zjesť porciu</summary>
                <form action={consume}>
                  <input name="package_id" type="hidden" value={p.id} />
                  <input name="request_id" type="hidden" value={randomUUID()} />
                  <label>
                    Množstvo (g)
                    <input
                      name="grams"
                      type="number"
                      min={1}
                      max={p.remaining_g}
                      defaultValue={p.remaining_g}
                      required
                    />
                  </label>
                  <button>Potvrdiť konzumáciu</button>
                </form>
              </details>
              <details>
                <summary>Presunúť</summary>
                <form action={move}>
                  <input name="package_id" type="hidden" value={p.id} />
                  <input name="request_id" type="hidden" value={randomUUID()} />
                  <label>
                    Lokácia
                    <select name="location_id" required>
                      {locations?.map((l) => (
                        <option value={l.id} key={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button disabled={!locations?.length}>Potvrdiť presun</button>
                </form>
              </details>
              <a className="button" href={"/labels/" + p.id}>
                QR štítok
              </a>
            </article>
          ))}
      </div>
      {!items?.length && (
        <p className="empty">
          Mraznička je prázdna. V knihe receptov vytvorte várku.
        </p>
      )}
      <section className="card">
        <h2>História konzumácie</h2>
        <History />
      </section>
    </div>
  );
}
async function History() {
  const { client } = await userDb();
  const { data, error } = await client
    .from("meal_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data?.length ? (
    <ul>
      {data.map((m) => (
        <li key={m.id}>
          {new Date(m.created_at).toLocaleString("sk-SK", {
            timeZone: "Europe/Prague",
          })}{" "}
          · {m.name} · {m.grams} g · {money(m.cost_minor)}
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted">Zatiaľ žiadne zaznamenané jedlá.</p>
  );
}
