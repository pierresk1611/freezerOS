import sharp from "sharp";
export async function optimizePhoto(input: Buffer) {
  const image = sharp(input, { limitInputPixels: 24000000, failOn: "warning" });
  const meta = await image.metadata();
  if (
    !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
    (meta.pages ?? 1) > 1
  )
    throw new Error("Unsupported image");
  const large = await image
    .clone()
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
  const thumbnail = await image
    .clone()
    .rotate()
    .resize({ width: 640, height: 480, fit: "cover", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  return { large, thumbnail }; // Metadata (including GPS) is stripped by default.
}
