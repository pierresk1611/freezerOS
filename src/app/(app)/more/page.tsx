import Link from "next/link";
export default function Page() {
  return (
    <div className="recipe-page">
      <h1>Viac</h1>
      <div className="food-kpis">
        {[
          ["/food-cost", "Food Cost"],
          ["/shopping", "Nákupy a špajza"],
          ["/food-cost/receipts/new", "Naskenovať účtenku"],
          ["/portioning", "Formy a porciovanie"],
          ["/meal-plan", "Jedálniček"],
          ["/preferences", "Moje chute a účet"],
        ].map(([h, n]) => (
          <Link className="card" href={h} key={h}>
            <h2>{n}</h2>
          </Link>
        ))}
      </div>
    </div>
  );
}
