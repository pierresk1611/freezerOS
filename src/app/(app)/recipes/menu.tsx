"use client";
import { useFormStatus } from "react-dom";
import { useRef } from "react";
import Link from "next/link";
import { MoreHorizontal, ArrowUpRight, Copy, Archive, X } from "lucide-react";
import { archiveRecipe } from "../actions";
export function RecipeMenu({
  id,
  name,
  requestId,
}: {
  id: string;
  name: string;
  requestId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <>
      <details className="recipe-menu" ref={menu}>
        <summary aria-label={"Možnosti receptu " + name}>
          <MoreHorizontal size={22} />
        </summary>
        <div className="recipe-menu-panel">
          <Link href={"/recipes/" + id + "/edit"}>
            <ArrowUpRight size={17} />
            Upraviť recept
          </Link>
          <Link href={"/recipes/new?from=" + id}>
            <Copy size={17} />
            Duplikovať
          </Link>
          <button
            type="button"
            onClick={() => {
              if (menu.current) menu.current.open = false;
              dialog.current?.showModal();
            }}
          >
            <Archive size={17} />
            Archivovať
          </button>
        </div>
      </details>
      <dialog
        ref={dialog}
        className="recipe-dialog"
        aria-labelledby={"archive-" + requestId}
      >
        <button
          type="button"
          className="icon-button"
          aria-label="Zavrieť potvrdenie"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
        <h2 id={"archive-" + requestId}>Archivovať recept?</h2>
        <p>
          „{name}“ zmizne z katalógu. Historické várky, zásoby a história
          zostanú zachované.
        </p>
        <form action={archiveRecipe}>
          <input type="hidden" name="recipe_id" value={id} />
          <input type="hidden" name="request_id" value={requestId} />
          <ArchiveControls onCancel={() => dialog.current?.close()} />
        </form>
      </dialog>
    </>
  );
}

function ArchiveControls({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="row">
      <button
        type="button"
        className="button-secondary"
        onClick={onCancel}
        disabled={pending}
      >
        Zrušiť
      </button>
      <button disabled={pending}>
        {pending ? "Archivujem…" : "Potvrdiť archiváciu"}
      </button>
    </div>
  );
}
