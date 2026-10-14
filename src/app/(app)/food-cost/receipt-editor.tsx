"use client";
/* eslint-disable @next/next/no-img-element */
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  categories,
  emptyItem,
  minor,
  money,
  receiptCheck,
  receiptSchema,
  possibleRepeatedItems,
  suggestCategory,
  type Receipt,
  type ReceiptItem,
} from "@/lib/food-cost";
type Document = { id: string; url: string; mime: string; filename: string };
export default function ReceiptEditor({
  id,
  revision,
  initial,
  documents,
  configured,
  status,
  aliases,
}: {
  id: string;
  revision: number;
  initial: Receipt;
  documents: Document[];
  configured: boolean;
  status: string;
  aliases: Record<
    string,
    {
      category: ReceiptItem["category"];
      ingredient_name: string | null;
      product_name: string | null;
    }
  >;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [duplicate, setDuplicate] = useState(false),
    [allowDuplicate, setAllowDuplicate] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const [cancelConfirmation, setCancelConfirmation] = useState(false);
  const [notice, setNotice] = useState("");
  const check = receiptCheck(data);
  async function api(body: object) {
    const r = await fetch("/api/food-cost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j;
  }
  function change(i: number, patch: Partial<ReceiptItem>) {
    setData((d) => ({
      ...d,
      items: d.items.map((x, n) => (n === i ? { ...x, ...patch } : x)),
    }));
    requestId.current = crypto.randomUUID();
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const original of Array.from(files)) {
        const file = await prepareReceiptFile(original);
        if (file.size > 4000000)
          throw new Error("Dokument je väčší než 4 MB. Vyberte menší súbor.");
        const form = new FormData();
        form.set("receipt", id);
        form.set("file", file);
        const r = await fetch("/api/food-cost", { method: "POST", body: form });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function recognize() {
    setBusy(true);
    setError("");
    try {
      const j = await api({ action: "recognize", id, consent });
      const d = j.data;
      setData({
        ...d,
        merchant: d.merchant ?? "",
        date: d.date ?? "",
        items: d.items.length
          ? d.items.map((x: ReceiptItem) => ({
              ...x,
              ...(aliases[x.name.toLowerCase().trim()] ?? {}),
              category:
                aliases[x.name.toLowerCase().trim()]?.category ??
                (x.category === "food" ? suggestCategory(x.name) : x.category),
            }))
          : [emptyItem()],
      });
      requestId.current = crypto.randomUUID();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const parsed = receiptSchema.safeParse(data);
      if (!parsed.success)
        throw new Error(
          "Doplňte obchod, platný dátum, názvy položiek a skontrolujte množstvá.",
        );
      if (!check.valid)
        throw new Error("Doplňte všetky ceny a opravte rozdiel súčtu.");
      await api({
        action: "save",
        id,
        revision,
        requestId: requestId.current,
        data,
        duplicateConfirmed: allowDuplicate,
      });
      router.push("/food-cost");
      router.refresh();
    } catch (e) {
      if ((e as Error).message === "POSSIBLE_DUPLICATE") {
        setDuplicate(true);
        setError(
          "Podobný nákup už existuje. Skontrolujte obchod, objednávku a priložené dokumenty.",
        );
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancelPurchase() {
    setBusy(true);
    setError("");
    try {
      await api({
        action: "cancel",
        id,
        revision,
        requestId: crypto.randomUUID(),
      });
      router.push("/food-cost");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <h2>{status === "draft" ? "Skontrolovať účtenku" : "Opraviť nákup"}</h2>
      <p>
        Rozpoznanie nevytvorí nákup. Prázdne ceny sú neznáme; finančný prehľad
        vznikne až po potvrdení.
      </p>
      {notice && (
        <p className="food-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="food-warning">
          {error}
        </p>
      )}
      <div className="receipt-workspace">
        <section className="card receipt-original">
          <h3>Originál dokumentu</h3>
          {status === "draft" && (
            <>
              <label className="button">
                Vybrať dokumenty
                <input
                  aria-label="Nahrať účtenku"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  multiple
                  disabled={busy}
                  onChange={(e) => void upload(e.target.files)}
                />
              </label>
              <label className="button">
                Odfotiť účtenku
                <input
                  aria-label="Odfotiť účtenku"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={busy}
                  onChange={(e) => void upload(e.target.files)}
                />
              </label>
              <p>
                JPG, PNG, WEBP alebo PDF do 4 MB; najviac 8 dokumentov a 20
                strán na PDF.
              </p>
              <p>
                {configured
                  ? "Rozpoznávanie cez OpenAI je nakonfigurované. Výsledok vždy skontrolujte."
                  : "Automatické rozpoznávanie nie je nakonfigurované. Manuálne zadanie funguje bez AI."}
              </p>
              {configured && (
                <>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    Súhlasím s odoslaním všetkých priložených dokumentov do
                    OpenAI na rozpoznanie. Môžu obsahovať osobné údaje.
                    Spracovanie môže byť spoplatnené podľa API účtu.
                  </label>
                  <button
                    disabled={busy || !consent || !documents.length}
                    onClick={() => void recognize()}
                  >
                    Rozpoznať položky
                  </button>
                </>
              )}
            </>
          )}
          {documents.map((d) => (
            <article key={d.id}>
              <a href={d.url} target="_blank" rel="noreferrer">
                {d.filename}
              </a>
              {d.mime === "application/pdf" ? (
                <iframe title={d.filename} src={d.url} />
              ) : (
                <img src={d.url} alt="Originál účtenky" />
              )}
            </article>
          ))}
          {!documents.length && <p>Manuálne zadanie nevyžaduje fotografiu.</p>}
        </section>
        <section className="card">
          <fieldset disabled={busy || status === "cancelled"}>
            <legend>Údaje nákupu</legend>
            <div className="food-fields">
              <label>
                Obchod
                <input
                  value={data.merchant}
                  onChange={(e) =>
                    setData({ ...data, merchant: e.target.value })
                  }
                />
              </label>
              <label>
                Dátum nákupu
                <input
                  type="date"
                  value={data.date}
                  onChange={(e) => setData({ ...data, date: e.target.value })}
                />
              </label>
              <label>
                Číslo objednávky
                <input
                  value={data.order_number}
                  onChange={(e) =>
                    setData({ ...data, order_number: e.target.value })
                  }
                />
              </label>
              <label>
                Zaplatené spolu (CZK)
                <MoneyInput
                  value={data.total_minor}
                  onChange={(v) => setData({ ...data, total_minor: v })}
                />
              </label>
            </div>
            <p>
              Mena CZK. Cena položky je výsledná cena po zľave. Vratky zadávajte
              so zápornou cenou. Jednotková cena sa prepisuje tak, ako je
              uvedená na doklade; porovnateľná cena sa počíta z konečnej ceny a
              skutočného množstva. Neznámu zľavu nechajte prázdnu.
            </p>
            <div className="receipt-table-wrap">
              <table className="receipt-items">
                <thead>
                  <tr>
                    {[
                      "Kontrola",
                      "Produkt",
                      "Kategória",
                      "Množstvo",
                      "Jednotka",
                      "Jednotková cena Kč",
                      "Zľava Kč",
                      "Celkom Kč",
                      "Normalizovaný produkt",
                      "Surovina",
                      "Akcie",
                    ].map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item, i) => (
                    <tr
                      key={i}
                      className={`receipt-line ${item.confidence !== null && item.confidence < 0.8 ? "uncertain" : ""}`}
                    >
                      <td>
                        <h3>
                          Položka {i + 1}
                          {item.confidence !== null
                            ? ` · istota ${Math.round(item.confidence * 100)} %`
                            : " · manuálne / neznáme"}
                        </h3>
                      </td>
                      <td>
                        <label>
                          Produkt
                          <input
                            value={item.name}
                            onChange={(e) => {
                              const name = e.target.value,
                                a = aliases[name.toLowerCase().trim()];
                              change(i, {
                                name,
                                category: a?.category ?? suggestCategory(name),
                                ingredient_name:
                                  a?.ingredient_name ?? item.ingredient_name,
                                product_name:
                                  a?.product_name ?? item.product_name,
                              });
                            }}
                          />
                        </label>
                      </td>
                      <td>
                        <label>
                          Kategória
                          <select
                            aria-label="Kategória"
                            value={item.category}
                            onChange={(e) =>
                              change(i, {
                                category: e.target
                                  .value as ReceiptItem["category"],
                              })
                            }
                          >
                            {Object.entries(categories).map(([v, n]) => (
                              <option key={v} value={v}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                      </td>
                      <td>
                        <label>
                          Množstvo
                          <input
                            type="number"
                            min=".0001"
                            step="any"
                            value={item.quantity ?? ""}
                            onChange={(e) =>
                              change(i, {
                                quantity: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              })
                            }
                          />
                        </label>
                      </td>
                      <td>
                        <label>
                          Jednotka
                          <select
                            aria-label="Jednotka"
                            value={item.unit ?? ""}
                            onChange={(e) =>
                              change(i, {
                                unit: (e.target.value ||
                                  null) as ReceiptItem["unit"],
                              })
                            }
                          >
                            <option value="">Neznáma</option>
                            {["g", "kg", "ml", "l", "ks", "balenie"].map(
                              (u) => (
                                <option key={u}>{u}</option>
                              ),
                            )}
                          </select>
                        </label>
                      </td>
                      <td>
                        <label>
                          Jednotková cena (CZK)
                          <MoneyInput
                            value={item.unit_price_minor}
                            onChange={(v) => change(i, { unit_price_minor: v })}
                          />
                        </label>
                      </td>
                      <td>
                        <label>
                          Zľava (CZK)
                          <MoneyInput
                            value={item.discount_minor}
                            onChange={(v) => change(i, { discount_minor: v })}
                          />
                        </label>
                      </td>
                      <td>
                        <label>
                          Celkom po zľave (CZK)
                          <MoneyInput
                            value={item.total_minor}
                            onChange={(v) => change(i, { total_minor: v })}
                          />
                        </label>
                      </td>
                      <td>
                        <label>
                          Normalizovaný produkt
                          <input
                            placeholder="Spoločný názov pre rôzne označenia"
                            value={item.product_name ?? ""}
                            onChange={(e) =>
                              change(i, {
                                product_name: e.target.value || null,
                              })
                            }
                          />
                        </label>
                      </td>
                      <td>
                        <label>
                          Mapovanie na surovinu
                          <input
                            placeholder="Voliteľný názov suroviny z receptu"
                            value={item.ingredient_name ?? ""}
                            onChange={(e) =>
                              change(i, {
                                ingredient_name: e.target.value || null,
                              })
                            }
                          />
                        </label>
                      </td>
                      <td>
                        <button
                          className="secondary"
                          onClick={() =>
                            setData({
                              ...data,
                              items: data.items.filter((_, n) => n !== i),
                            })
                          }
                        >
                          Odstrániť položku {i + 1}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="secondary"
              onClick={() =>
                setData({ ...data, items: [...data.items, emptyItem()] })
              }
            >
              Pridať položku
            </button>
          </fieldset>
          <p>
            Možné opakované položky:{" "}
            {possibleRepeatedItems(data.items).length
              ? possibleRepeatedItems(data.items)
                  .map((i) => i + 1)
                  .join(", ") +
                ". Skontrolujte prekrytie screenshotov; položky sa automaticky nemažú."
              : "žiadne"}
          </p>
          <div
            className={check.valid ? "food-success" : "food-warning"}
            role="status"
          >
            <p>Súčet položiek: {money(check.sum)}</p>
            <p>
              {!check.complete
                ? "Doplňte neznáme ceny."
                : check.valid
                  ? "Súčet sedí s účtenkou."
                  : `Rozdiel: ${money(check.difference ?? 0)}`}
            </p>
          </div>
          {duplicate && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={allowDuplicate}
                onChange={(e) => {
                  setAllowDuplicate(e.target.checked);
                  requestId.current = crypto.randomUUID();
                }}
              />
              Skontroloval som duplicitu; ide o samostatný nákup, ktorý chcem
              započítať.
            </label>
          )}
          {status === "draft" && (
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api({ action: "draft", id, revision, data });
                  router.refresh();
                  setNotice(
                    "Pracovný návrh je uložený; vo výdavkoch sa nezapočítava.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Uložiť pracovný návrh
            </button>
          )}
          <button
            disabled={busy || !check.valid || status === "cancelled"}
            onClick={() => void save()}
          >
            {busy
              ? "Spracúvam…"
              : status === "draft"
                ? "Potvrdiť nákup"
                : "Uložiť opravu nákupu"}
          </button>
          {status === "confirmed" &&
            (!cancelConfirmation ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setCancelConfirmation(true)}
              >
                Stornovať nákup
              </button>
            ) : (
              <div
                className="food-warning"
                role="group"
                aria-label="Potvrdenie storna"
              >
                <p>
                  Stornovaný nákup sa prestane započítavať do výdavkov. História
                  zostane zachovaná.
                </p>
                <button disabled={busy} onClick={() => void cancelPurchase()}>
                  Potvrdiť storno
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setCancelConfirmation(false)}
                >
                  Zachovať nákup
                </button>
              </div>
            ))}
        </section>
      </div>
    </>
  );
}
function MoneyInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [state, setState] = useState({
    value,
    text: value === null ? "" : (value / 100).toFixed(2),
  });
  if (state.value !== value)
    setState({ value, text: value === null ? "" : (value / 100).toFixed(2) });
  return (
    <input
      inputMode="decimal"
      value={state.text}
      onChange={(e) => {
        const n = minor(e.target.value);
        setState({ value: n, text: e.target.value });
        onChange(n);
      }}
    />
  );
}

async function prepareReceiptFile(file: File): Promise<File> {
  if (file.type === "application/pdf") return file;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "Použite JPG, PNG, WEBP alebo PDF. HEIC zatiaľ nie je podporovaný.",
    );
  if (file.size > 20000000)
    throw new Error("Fotografia môže mať najviac 20 MB pred zmenšením.");
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 2400 / bitmap.width, 3600 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Fotografiu sa nepodarilo pripraviť.");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.88),
  );
  if (!blob) throw new Error("Fotografiu sa nepodarilo zmenšiť.");
  return new File([blob], file.name, { type: blob.type });
}
