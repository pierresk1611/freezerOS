import { userDb } from "@/lib/supabase";
import { notFound } from "next/navigation";
import Link from "next/link";
export default async function Label({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { client } = await userDb();
  const { data: p, error } = await client
    .from("inventory_packages")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !p) notFound();
  return (
    <section className="card">
      <h1>Štítok 50 × 30 mm</h1>
      <h2>{p.name}</h2>
      <p>
        {p.initial_g} g · {p.portions ?? "Neznámy počet"} porcií ·{" "}
        {p.cube_count ?? "Neznámy počet"} kociek
      </p>
      <p>
        Kompletný štítok obsahuje ID, hmotnosť, porcie, dátum výroby a
        zmrazenia, dátum kvality a QR. Pri starších záznamoch chýbajúce dátumy
        nevymýšľame.
      </p>
      <div className="photo-actions">
        <a className="button" href={`/api/labels/${id}?format=png`}>
          Stiahnuť štítok PNG
        </a>
        <a className="button" href={`/api/labels/${id}?format=pdf`}>
          Stiahnuť štítok PDF
        </a>
      </div>
      <p>
        Export importujte do aplikácie NIIMBOT B1 a nastavte rozmer 50 × 30 mm.
        Priama Bluetooth tlač nie je overená. PDF má presný fyzický rozmer;
        tlačte pri 100 % bez prispôsobenia.
      </p>
      <Link href={"/inventory?id=" + id}>Späť na balíček</Link>
    </section>
  );
}
