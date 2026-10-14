import { it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRecipePhotos } from "../src/lib/recipe-photos";
function fixture(result: unknown) {
  return {
    from: () => ({
      select: () => ({
        in: () => ({ order: () => ({ order: async () => result }) }),
      }),
    }),
    storage: {
      from: () => ({
        createSignedUrls: async () => ({
          error: null,
          data: [
            { path: "large", signedUrl: "https://example.org/signed-large" },
            { path: "thumb", signedUrl: "https://example.org/signed-thumb" },
          ],
        }),
      }),
    },
  } as unknown as SupabaseClient;
}
it("loads actual photo rows and both optimized signed URLs", async () => {
  const client = fixture({
    error: null,
    data: [
      {
        id: "photo",
        recipe_id: "root",
        storage_path: "large",
        thumbnail_path: "thumb",
        alt: "Moje jedlo",
        source_type: "own",
      },
    ],
  });
  const photos = await loadRecipePhotos(client, ["root"]);
  expect(photos.get("root")?.[0]).toMatchObject({
    id: "photo",
    alt: "Moje jedlo",
    url: "https://example.org/signed-large",
    thumbnail: "https://example.org/signed-thumb",
  });
  expect(photos.needsMigration).toBe(false);
});
it("keeps old recipes available before the additive photo migration", async () => {
  const photos = await loadRecipePhotos(
    fixture({ error: { code: "PGRST205" }, data: null }),
    ["root"],
  );
  expect(photos.size).toBe(0);
  expect(photos.needsMigration).toBe(true);
});
it("does not disguise unrelated database failures as missing migrations", async () => {
  await expect(
    loadRecipePhotos(fixture({ error: { code: "42501" }, data: null }), [
      "root",
    ]),
  ).rejects.toMatchObject({ code: "42501" });
});
