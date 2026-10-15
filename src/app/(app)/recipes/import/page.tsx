import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ImportEditor } from "../editor";
export default function ImportPage() {
  return (
    <div className="recipe-page recipe-editor-page">
      <Link href="/recipes" className="back-link">
        <ArrowLeft size={18} />
        Späť do kuchárky
      </Link>
      <h1>Import receptov</h1>
      <p className="muted">
        Nahrajte JSON alebo ho vložte. Najprv skontrolujte náhľad, potom
        potvrďte uloženie.
      </p>
      <section className="card">
        <ImportEditor />
      </section>
      <section className="card">
        <h2>Oprava pokynov pôvodných šablón</h2>
        <p>
          Už importované recepty sa aktualizujú iba po kontrole a potvrdení
          novej verzie.
        </p>
        <Link href="/recipes/corrections" className="button button-secondary">
          Skontrolovať skladovanie a zohrievanie
        </Link>
      </section>
    </div>
  );
}
