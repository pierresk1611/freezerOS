import { configured } from "@/lib/supabase";
import { login } from "./actions";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="auth">
      <div className="brand">❄ FREEZER OS</div>
      <h1>
        Vaše jedlo.
        <br />
        Váš prehľad.
      </h1>
      <p className="muted">Prihláste sa do svojej kuchyne.</p>
      {!configured() ? (
        <div className="card">
          <h2>Pripojte Supabase</h2>
          <p>
            Aplikácia zatiaľ nie je pripojená k databáze. Nastavte
            NEXT_PUBLIC_SUPABASE_URL a NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            podľa README.
          </p>
          <p>Žiadne ukážkové zásoby ani finančné údaje sa nevytvárajú.</p>
        </div>
      ) : (
        <form action={login} className="card">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
          />
          <label htmlFor="password">Heslo</label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={8}
            required
            autoComplete="current-password"
          />
          {error && (
            <p className="error">
              Prihlásenie sa nepodarilo. Skontrolujte údaje.
            </p>
          )}
          <button style={{ marginTop: 20, width: "100%" }}>Prihlásiť sa</button>
          <p>
            <small>
              Účet zatiaľ vytvorte cez Supabase Auth. Verejná registrácia nie je
              zapnutá.
            </small>
          </p>
        </form>
      )}
    </main>
  );
}
