"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChefHat } from "lucide-react";
export function CookingMode({
  name,
  steps,
  id,
}: {
  name: string;
  steps: string[];
  id: string;
}) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  function change(next: number) {
    setIndex(next);
    setTimeout(() => heading.current?.focus(), 0);
  }
  return (
    <section className="cooking-mode">
      <div className="eyebrow">VARENIE BEZ ROZPTYĽOVANIA</div>
      <h1>{name}</h1>
      <div
        className="cooking-progress"
        aria-label={"Krok " + (index + 1) + " z " + steps.length}
      >
        {steps.map((_, n) => (
          <span key={n} className={n <= index ? "complete" : ""} />
        ))}
      </div>
      {done ? (
        <div className="cooking-step">
          <Check size={40} />
          <h2 ref={heading} tabIndex={-1}>
            Hotovo. Dobrú chuť!
          </h2>
          <p>
            Varenie samo nevytvára zásoby. Zaznamenajte skutočnú hmotnosť a
            náklady hotovej várky.
          </p>
          <Link className="button" href={"/recipes/" + id + "/batch"}>
            <ChefHat size={18} />
            Zaevidovať várku
          </Link>
          <button
            className="button-secondary"
            onClick={() => {
              setDone(false);
              change(0);
            }}
          >
            Prejsť kroky znova
          </button>
        </div>
      ) : (
        <>
          <div className="cooking-step">
            <span className="recipe-category">
              KROK {index + 1} / {steps.length}
            </span>
            <h2 ref={heading} tabIndex={-1}>
              {steps[index]}
            </h2>
          </div>
          <div className="cooking-controls">
            <button
              className="button-secondary"
              disabled={index === 0}
              onClick={() => change(index - 1)}
            >
              <ArrowLeft size={18} />
              Predchádzajúci
            </button>
            <button
              onClick={() => {
                if (index === steps.length - 1) {
                  setDone(true);
                  setTimeout(() => heading.current?.focus(), 0);
                } else change(index + 1);
              }}
            >
              {index === steps.length - 1 ? "Dokončiť" : "Ďalší krok"}
              <ArrowRight size={18} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
