import Link from "next/link";
import { BookOpen } from "lucide-react";
export default function MissingRecipe() {
  return (
    <section className="recipe-page recipe-empty">
      <BookOpen size={36} />
      <h1>Recept nie je dostupný</h1>
      <p className="muted">
        Mohol byť archivovaný alebo k nemu nemáte prístup.
      </p>
      <Link href="/recipes" className="button">
        Späť do kuchárky
      </Link>
    </section>
  );
}
