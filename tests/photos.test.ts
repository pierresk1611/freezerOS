import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { optimizePhoto } from "../src/lib/photo-processing";
import {
  photoFileError,
  PHOTO_BYTES,
  photoOrderSchema,
} from "../src/lib/photo-rules";
import { importSchema } from "../src/lib/domain";
import seed from "../docs/seed-recipes.json";
describe("Recipe photography", () => {
  it("accepts safe formats and rejects unsupported, empty and oversized files", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"])
      expect(photoFileError(120, type)).toBeNull();
    for (const type of [
      "image/svg+xml",
      "text/html",
      "image/heic",
      "image/heif",
    ])
      expect(photoFileError(120, type)).not.toBeNull();
    expect(photoFileError(0, "image/jpeg")).not.toBeNull();
    expect(photoFileError(PHOTO_BYTES + 1, "image/jpeg")).not.toBeNull();
  });
  it("re-encodes resized images and removes EXIF", async () => {
    const raw = await sharp({
      create: { width: 1800, height: 1000, channels: 3, background: "#a35232" },
    })
      .jpeg()
      .withMetadata()
      .toBuffer();
    const { large, thumbnail } = await optimizePhoto(raw);
    const a = await sharp(large).metadata(),
      b = await sharp(thumbnail).metadata();
    expect(a.format).toBe("webp");
    expect(a.width).toBe(1600);
    expect(a.exif).toBeUndefined();
    expect(b.width).toBe(640);
    expect(b.height).toBe(480);
  });
  it("rejects disguised SVG and broken data", async () => {
    await expect(
      optimizePhoto(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
        ),
      ),
    ).rejects.toThrow();
    await expect(optimizePhoto(Buffer.from("broken"))).rejects.toThrow();
  });
  it("checks photo ordering payload and limits", () => {
    expect(
      photoOrderSchema.safeParse({ revision: 0, photos: [] }).success,
    ).toBe(true);
    expect(
      photoOrderSchema.safeParse({
        revision: 0,
        photos: Array(9).fill({ id: crypto.randomUUID(), alt: "Jedlo" }),
      }).success,
    ).toBe(false);
    expect(
      photoOrderSchema.safeParse({
        revision: 0,
        photos: [{ id: crypto.randomUUID(), alt: "" }],
      }).success,
    ).toBe(false);
  });
  it("keeps imports without photos and validates review-only HTTPS references", () => {
    expect(importSchema.safeParse(seed).success).toBe(true);
    const withImages = {
      ...seed,
      payload: [
        {
          ...seed.payload[0],
          imageReferences: [
            {
              sourceUrl: "https://example.org/photo",
              author: "Autor",
              license: "CC BY 4.0",
              alt: "Jedlo",
            },
          ],
        },
      ],
    };
    expect(
      importSchema.parse(withImages).payload[0].imageReferences,
    ).toHaveLength(1);
    withImages.payload[0].imageReferences[0].sourceUrl = "file:///etc/passwd";
    expect(importSchema.safeParse(withImages).success).toBe(false);
  });
});
