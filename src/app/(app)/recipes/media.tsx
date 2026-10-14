"use client";
import { useState, useRef, useEffect } from "react";
import { Utensils } from "lucide-react";
import type { RecipePhoto } from "@/lib/recipes";
function PhotoImage({ photo, large }: { photo: RecipePhoto; large: boolean }) {
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const image = imageRef.current;
      if (image?.complete && image.naturalWidth === 0) setFailed(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  if (failed || !photo.url)
    return (
      <div className="recipe-placeholder">
        <Utensils size={40} />
        <span>Fotografia nie je dostupná</span>
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      src={large ? photo.url : photo.thumbnail}
      alt={photo.alt}
      loading={large ? "eager" : "lazy"}
      onError={() => setFailed(true)}
    />
  );
}
export function RecipeMedia({
  photos = [],
  large = false,
}: {
  photos?: ReadonlyArray<RecipePhoto>;
  large?: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const cover = photos[Math.min(selected, photos.length - 1)];
  return (
    <div className="recipe-photo-gallery">
      <div className={"recipe-media " + (large ? "recipe-media-large" : "")}>
        {cover ? (
          <>
            <PhotoImage
              key={cover.id + cover.url}
              photo={cover}
              large={large}
            />
            {large && (
              <button
                type="button"
                className="photo-zoom"
                onClick={() => dialog.current?.showModal()}
              >
                Zväčšiť fotografiu
              </button>
            )}
          </>
        ) : (
          <div className="recipe-placeholder">
            <div className="plate">
              <Utensils size={large ? 58 : 40} strokeWidth={1.2} />
            </div>
            <span>Miesto pre vašu fotografiu</span>
          </div>
        )}
      </div>
      {cover?.source_type === "external" && (
        <p className="photo-credit">
          Ilustračná fotografia · {cover.author} · {cover.license}{" "}
          {large && cover.source_url && (
            <a
              href={cover.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Zdroj
            </a>
          )}
        </p>
      )}
      {large && photos.length > 1 && (
        <div className="photo-thumbnails">
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              aria-label={`Zobraziť fotografiu ${i + 1}`}
              aria-pressed={i === selected}
              onClick={() => setSelected(i)}
            >
              <PhotoImage photo={p} large={false} />
            </button>
          ))}
        </div>
      )}
      {large && cover && (
        <dialog ref={dialog} className="photo-lightbox">
          <button type="button" onClick={() => dialog.current?.close()}>
            Zavrieť fotografiu
          </button>
          <PhotoImage photo={cover} large />
        </dialog>
      )}
    </div>
  );
}
