import { z } from "zod";
export const PHOTO_LIMIT = 8;
export const PHOTO_BYTES = 10 * 1024 * 1024;
export const photoOrderSchema = z.object({
  revision: z.number().int().nonnegative(),
  photos: z
    .array(
      z.object({
        id: z.string().uuid(),
        alt: z.string().trim().min(1).max(300),
      }),
    )
    .max(PHOTO_LIMIT),
});
export function photoFileError(size: number, type: string) {
  if (size === 0) return "Súbor je prázdny.";
  if (size > PHOTO_BYTES) return "Fotografia môže mať najviac 10 MB.";
  if (!["image/jpeg", "image/png", "image/webp"].includes(type))
    return "Použite JPG, PNG alebo WEBP. HEIC/HEIF zatiaľ nie je podporovaný; v telefóne exportujte JPG.";
  return null;
}
export const imageReferenceSchema = z.object({
  sourceUrl: z
    .url()
    .refine((v) => new URL(v).protocol === "https:", "Vyžaduje sa HTTPS"),
  author: z.string().trim().min(1).max(200),
  license: z.string().trim().min(1).max(300),
  alt: z.string().trim().min(1).max(300),
});
