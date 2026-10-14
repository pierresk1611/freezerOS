"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
export default function Start() {
  const router = useRouter(),
    id = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await fetch("/api/food-cost", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "create", id: id.current }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error);
            router.push(`/food-cost/receipts/${id.current}`);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        Vytvoriť pracovný návrh
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
