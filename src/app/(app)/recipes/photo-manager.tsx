"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { RecipePhoto } from "@/lib/recipe-photos";
import { photoFileError, PHOTO_LIMIT } from "@/lib/photo-rules";
export type DraftPhoto = { id: string; file: File; alt: string; url: string };
// Small multipart requests stay below Vercel's request limit; the server revalidates/re-encodes.
export async function uploadPhoto(recipeId: string, file: File, alt: string) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error("Fotografiu sa nepodarilo pripraviť.")),
      "image/webp",
      0.82,
    ),
  );
  if (blob.size > 4 * 1024 * 1024)
    throw new Error("Fotografia je príliš veľká. Zvoľte menšiu fotografiu.");
  const form = new FormData();
  form.set("file", blob, "photo.webp");
  form.set("alt", alt);
  const response = await fetch(`/api/recipes/${recipeId}/photos`, {
    method: "POST",
    body: form,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Nahratie zlyhalo.");
}
export function PhotoManager({
  recipeId,
  initial = [],
  onDrafts,
}: {
  recipeId?: string;
  initial?: RecipePhoto[];
  onDrafts?: (photos: DraftPhoto[]) => void;
}) {
  const [photos, setPhotos] = useState(initial);
  const [drafts, setDrafts] = useState<DraftPhoto[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const router = useRouter();
  useEffect(
    () => () => urls.current.forEach((url) => URL.revokeObjectURL(url)),
    [],
  );
  async function refresh() {
    const r = await fetch(`/api/recipes/${recipeId}/photos`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    setPhotos(d.photos);
    setRevision(d.revision);
    setLoadError(false);
    return d;
  }
  useEffect(() => {
    if (!recipeId) return;
    let active = true;
    fetch(`/api/recipes/${recipeId}/photos`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message);
        if (active) {
          setPhotos(d.photos);
          setRevision(d.revision);
          setLoadError(false);
        }
      })
      .catch((error) => {
        if (active) {
          setLoadError(true);
          setMessage(
            error instanceof Error &&
              !(error instanceof TypeError) &&
              !(error instanceof SyntaxError)
              ? error.message
              : "Fotografie sa nepodarilo načítať. Skontrolujte pripojenie a skúste znova.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [recipeId]);
  function changeDrafts(next: DraftPhoto[]) {
    setDrafts(next);
    onDrafts?.(next);
  }
  async function add(files: FileList | null) {
    if (!files || busy) return;
    setMessage("");
    const list = Array.from(files);
    if (
      list.length + (recipeId ? photos.length : drafts.length) >
      PHOTO_LIMIT
    ) {
      setMessage("Recept môže mať najviac 8 fotografií.");
      return;
    }
    for (const file of list) {
      const error = photoFileError(file.size, file.type);
      if (error) {
        setMessage(error);
        return;
      }
    }
    if (!recipeId) {
      const additions = list.map((file) => {
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        return {
          id: crypto.randomUUID(),
          file,
          alt: "Fotografia pripraveného jedla",
          url,
        };
      });
      changeDrafts([...drafts, ...additions]);
      return;
    }
    setBusy(true);
    try {
      for (const file of list)
        await uploadPhoto(recipeId, file, "Fotografia pripraveného jedla");
      await refresh();
      router.refresh();
      setMessage("Fotografie boli uložené.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Nahratie zlyhalo.");
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function save(next: RecipePhoto[], expectedRevision = revision) {
    if (busy || expectedRevision === null) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(`/api/recipes/${recipeId}/photos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: expectedRevision,
          photos: next.map((p) => ({ id: p.id, alt: p.alt })),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message);
      await refresh();
      router.refresh();
      setMessage(
        d.cleanupWarning
          ? "Zmena bola uložená; odstránenie súborov z úložiska sa nepodarilo."
          : "Zmena fotografií bola uložená.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Uloženie zlyhalo.");
    } finally {
      setBusy(false);
    }
  }
  const list = recipeId ? photos : drafts;
  function move(i: number, j: number) {
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    if (recipeId) void save(next as RecipePhoto[]);
    else changeDrafts(next as DraftPhoto[]);
  }
  return (
    <section
      id="photos"
      className="photo-manager"
      aria-label="Fotografie receptu"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void add(e.dataTransfer.files);
      }}
    >
      <h2>Fotografie receptu</h2>
      <p className="muted">
        Vaše jedlo, váš záber. Najviac 8 fotografií, JPG / PNG / WEBP, do 10 MB.
        Na počítači ich môžete pretiahnuť sem.
      </p>
      <p>
        <strong>Po výbere sa fotografia automaticky nahrá a uloží.</strong>{" "}
        Tlačidlo „Uložiť novú verziu“ dole na stránke ukladá text receptu.
      </p>
      <div className="photo-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          Pridať fotografiu
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => camera.current?.click()}
        >
          Odfotiť jedlo
        </button>
      </div>
      {loadError && (
        <div className="recipe-notice" role="alert">
          <p>
            Správa existujúcich fotografií nie je načítaná. Výber súboru zostáva
            dostupný; uloženie vyžaduje funkčné úložisko.
          </p>
          <p>
            <a
              href="https://github.com/pierresk1611/freezerOS/blob/main/docs/photos/repair.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ako aktivovať fotografie v správnom Supabase projekte
            </a>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await refresh();
                setMessage("Fotografie boli načítané.");
              } catch (error) {
                setMessage(
                  error instanceof Error && !(error instanceof TypeError)
                    ? error.message
                    : "Načítanie zlyhalo. Skúste znova.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Skúsiť načítať fotografie znova
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept="image/jpeg,image/png,image/webp"
        aria-label="Vybrať fotografie"
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={camera}
        type="file"
        hidden
        capture="environment"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Fotoaparát"
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      {recipeId && (
        <p>
          Fotografie sa ukladajú okamžite, bez vytvorenia novej verzie receptu.
          Zrušenie úprav receptu ich nevráti späť.
        </p>
      )}
      {!recipeId && (
        <p>Fotografie sa nahrajú po uložení receptu. Prvá je hlavná.</p>
      )}
      {busy && <p role="status">Ukladám fotografie…</p>}
      {message && <p role="status">{message}</p>}
      <div className="photo-management-grid">
        {list.map((p, i) => (
          <article key={p.id} className="photo-item">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={"thumbnail" in p ? p.thumbnail : p.url} alt={p.alt} />
            <strong>
              {i === 0 ? "Hlavná fotografia" : `Fotografia ${i + 1}`}
            </strong>
            <label>
              Alternatívny text
              <input
                maxLength={300}
                value={p.alt}
                disabled={busy || (!!recipeId && revision === null)}
                onChange={(e) => {
                  if (recipeId)
                    setPhotos(
                      photos.map((q) =>
                        q.id === p.id ? { ...q, alt: e.target.value } : q,
                      ),
                    );
                  else
                    changeDrafts(
                      drafts.map((q) =>
                        q.id === p.id ? { ...q, alt: e.target.value } : q,
                      ),
                    );
                }}
              />
            </label>
            <div className="photo-actions">
              {recipeId && (
                <button
                  type="button"
                  disabled={busy || revision === null}
                  onClick={() => void save(photos)}
                >
                  Uložiť popis
                </button>
              )}
              {i > 0 && (
                <button
                  type="button"
                  disabled={busy || (!!recipeId && revision === null)}
                  onClick={() => move(i, 0)}
                >
                  Nastaviť ako hlavnú
                </button>
              )}
              {i > 0 && (
                <button
                  type="button"
                  disabled={busy || (!!recipeId && revision === null)}
                  aria-label={`Fotografiu ${i + 1} hore`}
                  onClick={() => move(i, i - 1)}
                >
                  ↑
                </button>
              )}
              {i < list.length - 1 && (
                <button
                  type="button"
                  disabled={busy || (!!recipeId && revision === null)}
                  aria-label={`Fotografiu ${i + 1} dole`}
                  onClick={() => move(i, i + 1)}
                >
                  ↓
                </button>
              )}
              <button
                type="button"
                disabled={busy || (!!recipeId && revision === null)}
                onClick={() => {
                  if (!confirm("Odstrániť túto fotografiu?")) return;
                  if (recipeId) void save(photos.filter((q) => q.id !== p.id));
                  else changeDrafts(drafts.filter((q) => q.id !== p.id));
                }}
              >
                Odstrániť
              </button>
              <label className="photo-replace">
                Nahradiť
                <input
                  type="file"
                  disabled={busy || (!!recipeId && revision === null)}
                  accept="image/jpeg,image/png,image/webp"
                  aria-label={`Nahradiť fotografiu ${i + 1}`}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const error = photoFileError(file.size, file.type);
                    if (error) {
                      setMessage(error);
                      return;
                    }
                    if (!recipeId) {
                      const url = URL.createObjectURL(file);
                      urls.current.push(url);
                      changeDrafts(
                        drafts.map((q) =>
                          q.id === p.id ? { ...q, file, url } : q,
                        ),
                      );
                      return;
                    }
                    setMessage("");
                    setBusy(true);
                    try {
                      if (photos.length >= PHOTO_LIMIT)
                        throw new Error(
                          "Pri 8 fotografiách najprv jednu odstráňte, potom nahrajte náhradu.",
                        );
                      await uploadPhoto(recipeId, file, p.alt);
                      const fresh = await refresh();
                      const added = fresh.photos.find(
                        (q: RecipePhoto) =>
                          !photos.some((old) => old.id === q.id),
                      );
                      if (!added)
                        throw new Error("Náhradu sa nepodarilo nájsť.");
                      setBusy(false);
                      await save(
                        fresh.photos
                          .filter((q: RecipePhoto) => q.id !== added.id)
                          .map((q: RecipePhoto) => (q.id === p.id ? added : q)),
                        fresh.revision,
                      );
                    } catch (e) {
                      setMessage(
                        e instanceof Error ? e.message : "Náhrada zlyhala.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
