import QRCode from "qrcode";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type Font } from "opentype.js";
let labelFont: Font | undefined;
function textPath(text: string, y: number, size: number, maxWidth = 376) {
  if (!labelFont) {
    const bytes = readFileSync(
      join(process.cwd(), "assets/fonts/DejaVuSans.ttf"),
    );
    labelFont = parse(new Uint8Array(bytes).buffer);
  }
  const glyphs = Array.from(text.normalize("NFC")).map((character) =>
    labelFont!.charToGlyph(character),
  );
  const width =
    (glyphs.reduce(
      (sum, glyph) => sum + (glyph.advanceWidth ?? labelFont!.unitsPerEm),
      0,
    ) /
      labelFont.unitsPerEm) *
    size;
  const scale = Math.min(size, (size * maxWidth) / Math.max(1, width));
  let x = 12;
  return glyphs
    .map((glyph) => {
      const path = glyph.getPath(x, y, scale).toSVG(2);
      x +=
        ((glyph.advanceWidth ?? labelFont!.unitsPerEm) /
          labelFont!.unitsPerEm) *
        scale;
      return path;
    })
    .join("");
}
export type LabelPackage = {
  id: string;
  name: string;
  initial_g: number;
  portions: number | null;
  manufactured_on: string | null;
  frozen_on: string | null;
  best_before: string | null;
};
export async function packageLabel(
  p: LabelPackage,
  origin: string,
  format: "png" | "pdf",
) {
  const url = new URL("/inventory?id=" + p.id, origin).toString();
  const qr = await QRCode.toDataURL(url, {
    margin: 4,
    width: 116,
    errorCorrectionLevel: "M",
  });
  const name = p.name.match(/.{1,28}/gu)?.slice(0, 2) ?? [""];
  const date = (value: string | null) =>
    value ? value.split("-").reverse().join(".") : "Neznáme";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="white"/>${textPath("FREEZER OS", 20, 12)}${name.map((line, i) => textPath(line, 44 + i * 21, 17)).join("")}${textPath("ID: " + p.id.slice(0, 18), 87, 10)}${textPath(p.id.slice(18), 101, 10)}${textPath(`${p.initial_g} g · Porcie: ${p.portions ?? "?"}`, 125, 16, 245)}${textPath("Vyrobené: " + date(p.manufactured_on), 155, 12, 245)}${textPath("Zmrazené: " + date(p.frozen_on), 178, 12, 245)}${textPath("Kvalita do: " + date(p.best_before), 201, 12, 245)}${textPath("50 × 30 mm · dátum kvality nie je bezpečnostný limit", 225, 9, 250)}<rect x="270" y="111" width="124" height="124" fill="white"/><image href="${qr}" x="274" y="115" width="116" height="116"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  if (format === "png") return png;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([(50 / 25.4) * 72, (30 / 25.4) * 72]);
  const image = await pdf.embedPng(png);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
  });
  return Buffer.from(await pdf.save());
}
