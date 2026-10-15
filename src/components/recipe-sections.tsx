import Link from "next/link";

export function RecipeSections({ active }: { active: "library" | "projects" }) {
  return (
    <nav className="recipe-sections" aria-label="Sekcie receptov">
      <Link
        href="/recipes"
        aria-current={active === "library" ? "page" : undefined}
      >
        Knižnica receptov
      </Link>
      <Link
        href="/meal-preps"
        aria-current={active === "projects" ? "page" : undefined}
      >
        Meal prep projekty
      </Link>
    </nav>
  );
}
