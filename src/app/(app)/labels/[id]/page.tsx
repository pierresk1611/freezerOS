import Image from "next/image";
import { userDb } from "@/lib/supabase";
import QRCode from "qrcode";
import { notFound } from "next/navigation";
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
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!origin)
    return (
      <div className="card">
        <h1>QR štítok</h1>
        <p>
          Pre skenovateľný štítok nastavte NEXT_PUBLIC_APP_URL na HTTPS adresu
          nasadenej aplikácie.
        </p>
      </div>
    );
  const qr = await QRCode.toDataURL(
    new URL("/inventory?id=" + id, origin).toString(),
  );
  return (
    <div className="card">
      <h1>FREEZER OS</h1>
      <h2>{p.name}</h2>
      <p>
        {p.remaining_g} g · {p.best_before}
      </p>
      <Image
        unoptimized
        src={qr}
        width={192}
        height={192}
        alt={"QR balíčka " + p.name}
      />
      <p>
        <a className="button" href={qr} download={"freezer-" + id + ".png"}>
          Stiahnuť QR PNG
        </a>
      </p>
      <small>
        Export obsahuje QR kód. Kompletné tlačové štítky a PDF budú ďalším
        míľnikom.
      </small>
    </div>
  );
}
