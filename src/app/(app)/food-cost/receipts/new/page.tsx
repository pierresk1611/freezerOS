import NewReceipt from "./start";
export default function Page() {
  return (
    <section className="card">
      <h2>Nová účtenka</h2>
      <p>Odfotiť, nahrať dokument alebo zadať nákup ručne.</p>
      <NewReceipt />
    </section>
  );
}
