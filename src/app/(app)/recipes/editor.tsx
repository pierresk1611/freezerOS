"use client";
import { PhotoManager, uploadPhoto, type DraftPhoto } from "./photo-manager";
import type { RecipePhoto } from "@/lib/recipe-photos";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  Check,
} from "lucide-react";
import { recipeSchema, importSchema } from "@/lib/domain";
import { importRecipes } from "../actions";
import { saveRecipe, type SaveResult } from "./actions";
const editorSchema = recipeSchema.omit({ steps: true }).extend({
  steps: z
    .array(z.object({ text: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(100),
});
type Fields = z.input<typeof editorSchema>;
function FieldError({ invalid, text }: { invalid: unknown; text: string }) {
  return invalid ? (
    <p className="field-error" role="alert">
      {text}
    </p>
  ) : null;
}
export function RecipeEditor({
  requestId,
  recipeId,
  photos,
  initial,
  versionId,
  cancelHref = "/recipes",
}: {
  recipeId?: string;
  photos?: RecipePhoto[];
  requestId: string;
  initial?: z.infer<typeof recipeSchema>;
  versionId?: string;
  cancelHref?: string;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<DraftPhoto[]>([]);
  const [savedRecipeId, setSavedRecipeId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SaveResult>({});
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Fields, unknown, z.output<typeof editorSchema>>({
    resolver: zodResolver(editorSchema),
    defaultValues: initial
      ? { ...initial, steps: initial.steps.map((text) => ({ text })) }
      : {
          name: "",
          portions: 2,
          ingredients: [{ name: "", quantity: 100, unit: "g" }],
          steps: [{ text: "" }],
          reheating: "",
          storage:
            "Rýchlo schlaďte. Rozmrazujte v chladničke a dôkladne prehrejte.",
          meat: "none",
          freezing: true,
        },
  });
  const ingredients = useFieldArray({ control, name: "ingredients" });
  const steps = useFieldArray({ control, name: "steps" });
  return (
    <form
      noValidate
      className="recipe-editor"
      onSubmit={handleSubmit(async (values) => {
        if (
          values.cooking_minutes_min &&
          values.cooking_minutes_max &&
          values.cooking_minutes_min > values.cooking_minutes_max
        ) {
          setResult({
            message: "Začiatočný čas pečenia nemôže byť väčší než konečný.",
          });
          return;
        }
        if (drafts.some((p) => !p.alt.trim())) {
          setResult({ message: "Doplňte alternatívny text fotografií." });
          return;
        }
        setPending(true);
        setResult({});
        const form = new FormData();
        form.set("request_id", requestId);
        form.set("has_photos", drafts.length ? "true" : "false");
        form.set(
          "payload",
          JSON.stringify({ ...values, steps: values.steps.map((s) => s.text) }),
        );
        if (versionId) form.set("version_id", versionId);
        try {
          const response = await saveRecipe(form);
          if (response.destination && !response.recipeId) {
            router.push(response.destination);
            router.refresh();
            return;
          }
          if (response.destination && response.recipeId) {
            setSavedRecipeId(response.recipeId);
            try {
              for (const photo of drafts)
                await uploadPhoto(response.recipeId, photo.file, photo.alt);
            } catch (error) {
              setDrafts([]);
              setResult({
                message: `Recept bol uložený, ale fotografia sa nenahrala: ${error instanceof Error ? error.message : "Skúste znova."}`,
              });
              return;
            }
            router.push(response.destination);
            router.refresh();
          } else setResult(response);
        } catch {
          setResult({
            message:
              "Spojenie sa prerušilo. Úpravy zostávajú vo formulári; skúste znova.",
          });
        } finally {
          setPending(false);
        }
      })}
    >
      <section className="card">
        <h2>Spôsob prípravy a časy</h2>
        <label>
          Kategória
          <select
            {...register("category", { setValueAs: (v) => v || undefined })}
          >
            <option value="">Neurčená</option>
            <option value="general">Všeobecná</option>
            <option value="slow_roasted_pulled_meat">
              Pomaly pečené a trhané mäso
            </option>
          </select>
        </label>
        <label>
          Spôsob prípravy
          <select
            {...register("cooking_method", {
              setValueAs: (v) => v || undefined,
            })}
          >
            <option value="">Neurčený</option>
            <option value="oven">Rúra</option>
            <option value="stove">Sporák</option>
            <option value="slow_roast">Pomalé pečenie</option>
          </select>
        </label>
        {(
          [
            ["prep_minutes", "Čas prípravy (min)"],
            ["cooking_minutes_min", "Pečenie od (min)"],
            ["cooking_minutes_max", "Pečenie do (min)"],
            ["oven_c", "Teplota rúry (°C)"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={key === "oven_c" ? 50 : 1}
              max={
                key === "oven_c" ? 300 : key === "prep_minutes" ? 1440 : 2880
              }
              {...register(key, {
                setValueAs: (v) => (v === "" ? undefined : Number(v)),
              })}
            />
            <FieldError
              invalid={errors[key]}
              text="Skontrolujte čas alebo teplotu."
            />
          </label>
        ))}
      </section>
      <PhotoManager
        recipeId={recipeId ?? savedRecipeId}
        initial={photos}
        onDrafts={setDrafts}
      />
      {savedRecipeId && (
        <p role="status">
          Recept je uložený.{" "}
          <Link href={`/recipes/${savedRecipeId}/edit`}>
            Otvoriť uložený recept a doplniť fotografie
          </Link>
        </p>
      )}
      <section className="editor-section">
        <div className="eyebrow">01 · ZÁKLAD RECEPTU</div>
        <h2>Dajte jedlu meno</h2>
        <label htmlFor="recipe-name">Názov</label>
        <input
          id="recipe-name"
          {...register("name")}
          aria-invalid={!!errors.name}
          placeholder="Napríklad poctivý hovädzí guláš"
          maxLength={160}
        />
        <FieldError
          invalid={errors.name}
          text="Zadajte názov s 2 až 160 znakmi."
        />
        <div className="form-grid">
          <div>
            <label htmlFor="recipe-portions">Porcie</label>
            <input
              id="recipe-portions"
              type="number"
              min={1}
              max={100}
              {...register("portions", { valueAsNumber: true })}
              aria-invalid={!!errors.portions}
            />
            <FieldError
              invalid={errors.portions}
              text="Zadajte celé číslo od 1 do 100."
            />
          </div>
          <div>
            <label htmlFor="recipe-meat">Druh mäsa</label>
            <select id="recipe-meat" {...register("meat")}>
              <option value="none">Bez mäsa</option>
              <option value="beef">Hovädzie</option>
              <option value="pork">Bravčové</option>
              <option value="chicken">Kuracie</option>
              <option value="other">Ostatné</option>
              <option value="fish">Ryba</option>
            </select>
          </div>
        </div>
      </section>
      <section className="editor-section">
        <div className="eyebrow">02 · SUROVINY</div>
        <h2>Čo budeme potrebovať?</h2>
        <p className="muted">
          Zadajte množstvá pre celý recept. Objem sa automaticky neprepočítava
          na hmotnosť.
        </p>
        <div className="ingredient-editor-list">
          {ingredients.fields.map((field, i) => (
            <fieldset className="ingredient-editor-row" key={field.id}>
              <legend className="sr-only">Surovina {i + 1}</legend>
              <div className="ingredient-name">
                <label htmlFor={"ingredient-name-" + i}>
                  Názov suroviny {i + 1}
                </label>
                <input
                  id={"ingredient-name-" + i}
                  {...register(`ingredients.${i}.name`)}
                  placeholder="Surovina"
                  aria-invalid={!!errors.ingredients?.[i]?.name}
                />
                <FieldError
                  invalid={errors.ingredients?.[i]?.name}
                  text="Zadajte názov suroviny (najviac 120 znakov)."
                />
              </div>
              <div>
                <label htmlFor={"ingredient-qty-" + i}>Množstvo {i + 1}</label>
                <input
                  id={"ingredient-qty-" + i}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0.01"
                  max={1000000}
                  {...register(`ingredients.${i}.quantity`, {
                    valueAsNumber: true,
                  })}
                  aria-invalid={!!errors.ingredients?.[i]?.quantity}
                />
                <FieldError
                  invalid={errors.ingredients?.[i]?.quantity}
                  text="Zadajte kladné množstvo, najviac 1 000 000."
                />
              </div>
              <div>
                <label htmlFor={"ingredient-unit-" + i}>Jednotka {i + 1}</label>
                <select
                  id={"ingredient-unit-" + i}
                  {...register(`ingredients.${i}.unit`)}
                >
                  <option value="g">g</option>
                  <option value="ml">ml</option>
                  <option value="ks">ks</option>
                </select>
              </div>
              <button
                type="button"
                className="icon-button ingredient-remove"
                aria-label={"Odstrániť surovinu " + (i + 1)}
                disabled={ingredients.fields.length === 1 || pending}
                onClick={() => ingredients.remove(i)}
              >
                <Trash2 size={18} />
              </button>
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          className="button-secondary"
          disabled={ingredients.fields.length >= 100 || pending}
          onClick={() =>
            ingredients.append({ name: "", quantity: 100, unit: "g" })
          }
        >
          <Plus size={17} />
          Pridať surovinu
        </button>
      </section>
      <section className="editor-section">
        <div className="eyebrow">03 · POSTUP</div>
        <h2>Krok za krokom</h2>
        <p className="muted">
          Každý krok má vlastný priestor. Poradie môžete kedykoľvek zmeniť.
        </p>
        <div className="stack">
          {steps.fields.map((field, i) => (
            <div className="step-editor-row" key={field.id}>
              <div className="step-editor-top">
                <label htmlFor={"step-" + i}>Krok {i + 1}</label>
                <div className="row">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={"Posunúť krok " + (i + 1) + " hore"}
                    disabled={i === 0 || pending}
                    onClick={() => steps.move(i, i - 1)}
                  >
                    <ChevronUp size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={"Posunúť krok " + (i + 1) + " dole"}
                    disabled={i === steps.fields.length - 1 || pending}
                    onClick={() => steps.move(i, i + 1)}
                  >
                    <ChevronDown size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={"Odstrániť krok " + (i + 1)}
                    disabled={steps.fields.length === 1 || pending}
                    onClick={() => steps.remove(i)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
              <textarea
                id={"step-" + i}
                {...register(`steps.${i}.text`)}
                placeholder="Čo treba v tomto kroku urobiť?"
                aria-invalid={!!errors.steps?.[i]?.text}
              />
              <FieldError
                invalid={errors.steps?.[i]?.text}
                text="Vyplňte krok varenia (najviac 2 000 znakov)."
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          className="button-secondary"
          disabled={steps.fields.length >= 100 || pending}
          onClick={() => steps.append({ text: "" })}
        >
          <Plus size={17} />
          Pridať krok
        </button>
      </section>
      <section className="editor-section">
        <div className="eyebrow">04 · NA NESKÔR</div>
        <h2>Aby chutilo aj zajtra</h2>
        <label className="freeze-toggle">
          <input type="checkbox" {...register("freezing")} />
          <span>
            <strong>Vhodné na mrazenie</strong>
            <small>Vypnite napríklad pri majonézovom šaláte.</small>
          </span>
          <Check size={20} />
        </label>
        <label htmlFor="recipe-storage">Skladovacie odporúčania</label>
        <textarea
          id="recipe-storage"
          {...register("storage")}
          aria-invalid={!!errors.storage}
        />
        <FieldError
          invalid={errors.storage}
          text="Zadajte odporúčania na skladovanie (najviac 2 000 znakov)."
        />
        <label htmlFor="recipe-reheating">Postup zohrievania</label>
        <textarea
          id="recipe-reheating"
          {...register("reheating")}
          aria-invalid={!!errors.reheating}
        />
        <FieldError
          invalid={errors.reheating}
          text="Zadajte postup zohrievania (najviac 2 000 znakov)."
        />
      </section>
      {Object.keys(errors).length > 0 && (
        <p className="recipe-form-alert" role="alert">
          Skontrolujte označené polia. Recept zatiaľ nebol uložený.
        </p>
      )}
      {result.message && (
        <p className="recipe-form-alert" role="alert">
          {result.message}
        </p>
      )}
      <footer className="editor-actions">
        <Link className="button button-secondary" href={cancelHref}>
          Zrušiť
        </Link>
        <button disabled={pending}>
          <Save size={18} />
          {pending
            ? "Ukladám…"
            : versionId
              ? "Uložiť novú verziu"
              : "Uložiť recept"}
        </button>
      </footer>
    </form>
  );
}

export function ImportEditor() {
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<z.infer<typeof importSchema> | null>(
    null,
  );
  function validate() {
    try {
      const result = importSchema.safeParse(JSON.parse(text));
      if (!result.success) {
        setMessage(
          "Import nezodpovedá schéme 1.0. Skontrolujte povinné údaje.",
        );
        setPreview(null);
      } else {
        setPreview(result.data);
        setMessage("");
      }
    } catch {
      setMessage("JSON sa nepodarilo prečítať.");
      setPreview(null);
    }
  }
  return (
    <div>
      <label htmlFor="import-file">JSON súbor</label>
      <input
        id="import-file"
        type="file"
        accept=".json,application/json"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            if (file.size > 1000000) {
              setMessage("Maximálna veľkosť je 1 MB.");
              return;
            }
            setText(await file.text());
            setPreview(null);
          }
        }}
      />
      <label htmlFor="import-json">JSON obálka</label>
      <textarea
        id="import-json"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
      />
      <button onClick={validate} type="button">
        Skontrolovať a zobraziť náhľad
      </button>
      {message && (
        <p role="alert" className="error">
          {message}
        </p>
      )}
      {preview && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Náhľad importu</h2>
          <ul>
            {preview.payload.map((r, i) => (
              <li key={i}>
                {r.name} · {r.portions} porcie · {r.ingredients.length} surovín
              </li>
            ))}
          </ul>
          <p>Zdroj: {preview.source}. Pred potvrdením môžete JSON upraviť.</p>
          <form action={importRecipes}>
            <input type="hidden" name="json" value={JSON.stringify(preview)} />
            <button>Potvrdiť import {preview.payload.length} receptov</button>
          </form>
        </div>
      )}
    </div>
  );
}
