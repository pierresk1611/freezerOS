import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ImportEditor } from "../editor";
import { importDefaults } from "../../actions";
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
        <h2>Začnite obľúbenými jedlami</h2>
        <p>15 editovateľných šablón. Rovnaká sada sa pridá iba raz.</p>
        <form action={importDefaults}>
          <button>Pridať 15 receptových šablón</button>
        </form>
      </section>
    </div>
  );
}
