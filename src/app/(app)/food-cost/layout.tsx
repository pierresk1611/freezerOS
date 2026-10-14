import Link from "next/link";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="food-page">
      <header className="recipe-heading">
        <p className="eyebrow">VAŠA KUCHYŇA V ČÍSLACH</p>
        <h1>Food Cost</h1>
        <Link className="button" href="/food-cost/receipts/new">
          Naskenovať účtenku
        </Link>
      </header>
      <nav className="food-tabs" aria-label="Food Cost">
        {[
          ["", "Prehľad"],
          ["receipts", "Účtenky"],
          ["purchases", "Nákupy"],
          ["items", "Analýza položiek"],
          ["recipes", "Náklady na recepty"],
          ["prices", "Vývoj cien"],
          ["budget", "Rozpočet"],
        ].map(([p, n]) => (
          <Link key={p} href={`/food-cost/${p}`}>
            {n}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
