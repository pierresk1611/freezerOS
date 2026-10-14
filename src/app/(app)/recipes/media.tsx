import { Utensils } from "lucide-react";
import type { RecipePhoto } from "@/lib/recipes";
// A shared media slot accepts signed storage URLs; adding a photo loader later
// does not change the gallery, detail or editor layouts. No fake photos are persisted.
export function RecipeMedia({
  photos = [],
  large = false,
}: {
  photos?: ReadonlyArray<RecipePhoto>;
  large?: boolean;
}) {
  const cover = photos[0];
  return (
    <div className={"recipe-media " + (large ? "recipe-media-large" : "")}>
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover.url}
          alt={cover.alt}
          loading={large ? "eager" : "lazy"}
        />
      ) : (
        <div className="recipe-placeholder">
          <div className="plate">
            <Utensils size={large ? 58 : 40} strokeWidth={1.2} />
          </div>
          <span>Miesto pre vašu fotografiu</span>
        </div>
      )}
    </div>
  );
}
