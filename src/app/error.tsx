"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="card">
      <h2>Operáciu sa nepodarilo dokončiť</h2>
      <p>
        Skontrolujte pripojenie a konfiguráciu databázy. Údaje neopakujte
        naslepo.
      </p>
      <button onClick={reset}>Skúsiť znova</button>
    </div>
  );
}
