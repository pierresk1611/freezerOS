"use client";
import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { recipeSchema, importSchema } from "@/lib/domain";
import { createRecipe, importRecipes } from "../actions";
const editorSchema = recipeSchema
  .omit({ steps: true })
  .extend({ stepsText: z.string().trim().min(1) });
type Fields = z.input<typeof editorSchema>;
export function RecipeEditor({
  requestId,
  initial,
  versionId,
}: {
  requestId: string;
  initial?: z.infer<typeof recipeSchema>;
  versionId?: string;
}) {
  const [pending, setPending] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Fields, unknown, z.output<typeof editorSchema>>({
    resolver: zodResolver(editorSchema),
    defaultValues: initial
      ? { ...initial, stepsText: initial.steps.join("\n") }
      : {
          name: "",
          portions: 2,
          ingredients: [{ name: "", quantity: 100, unit: "g" }],
          stepsText: "",
          reheating: "",
          storage:
            "Rýchlo schlaďte. Rozmrazujte v chladničke a dôkladne prehrejte.",
          meat: "none",
          freezing: true,
        },
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "ingredients",
  });
  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        setPending(true);
        const form = new FormData();
        form.set("request_id", requestId);
        form.set("name", values.name);
        form.set("portions", String(values.portions));
        form.set("ingredients", JSON.stringify(values.ingredients));
        form.set("steps", values.stepsText);
        form.set("reheating", values.reheating);
        form.set("storage", values.storage);
        form.set("meat", values.meat);
        form.set("freezing", String(values.freezing));
        if (versionId) form.set("version_id", versionId);
        try {
          await createRecipe(form);
        } finally {
          setPending(false);
        }
      })}
    >
      <label htmlFor={requestId + "-name"}>Názov</label>
      <input
        id={requestId + "-name"}
        {...register("name")}
        required
        minLength={2}
      />
      <label htmlFor={requestId + "-portions"}>Porcie</label>
      <input
        id={requestId + "-portions"}
        type="number"
        {...register("portions", { valueAsNumber: true })}
        min={1}
        max={100}
        required
      />
      <label>Suroviny</label>
      <div className="stack">
        {fields.map((field, i) => (
          <fieldset className="card" key={field.id}>
            <legend>Surovina {i + 1}</legend>
            <label htmlFor={requestId + "-ingredient-" + i}>
              Názov suroviny
            </label>
            <input
              id={requestId + "-ingredient-" + i}
              {...register(`ingredients.${i}.name`)}
              required
            />
            <div className="form-grid">
              <label>
                Množstvo
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  {...register(`ingredients.${i}.quantity`, {
                    valueAsNumber: true,
                  })}
                  required
                />
              </label>
              <label>
                Jednotka
                <select {...register(`ingredients.${i}.unit`)}>
                  <option value="g">g</option>
                  <option value="ml">ml</option>
                  <option value="ks">ks</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              disabled={fields.length === 1}
              onClick={() => remove(i)}
            >
              Odstrániť surovinu {i + 1}
            </button>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        onClick={() => append({ name: "", quantity: 100, unit: "g" })}
        style={{ marginTop: 12 }}
      >
        + Pridať surovinu
      </button>
      <p>
        <small>Objem sa automaticky neprepočítava na hmotnosť.</small>
      </p>
      <label htmlFor={requestId + "-steps"}>
        Postup — jeden krok na riadok
      </label>
      <textarea id={requestId + "-steps"} {...register("stepsText")} required />
      <label htmlFor={requestId + "-reheating"}>Postup zohrievania</label>
      <textarea
        id={requestId + "-reheating"}
        {...register("reheating")}
        required
      />
      <label>
        Druh mäsa
        <select {...register("meat")}>
          <option value="none">Bez mäsa</option>
          <option value="beef">Hovädzie</option>
          <option value="pork">Bravčové</option>
          <option value="chicken">Kuracie</option>
          <option value="other">Ostatné</option>
          <option value="fish">Ryba</option>
        </select>
      </label>
      <label>
        Skladovacie odporúčania
        <textarea {...register("storage")} required />
      </label>
      <label className="row">
        <input
          style={{ width: 24 }}
          type="checkbox"
          {...register("freezing")}
        />
        Vhodné na mrazenie
      </label>
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="error">
          Skontrolujte názov, množstvá, postup a počet porcií.
        </p>
      )}
      <button disabled={pending}>
        {pending ? "Ukladám…" : "Uložiť recept"}
      </button>
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
