import { db } from "@/lib/supabase";
import { receiptSchema } from "@/lib/food-cost";
import { receiptProvider } from "@/lib/receipt-provider";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  let originHost = "";
  try {
    originHost = origin ? new URL(origin).host : "";
  } catch {}
  if (
    !origin ||
    originHost !== request.headers.get("host") ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return Response.json(
      { error: "Neplatný pôvod požiadavky." },
      { status: 403 },
    );
  const client = await db();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    return Response.json({ error: "Prihláste sa znova." }, { status: 401 });
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length")) > 4300000)
        throw new Error("Súbor je príliš veľký. Limit je 4 MB na dokument.");
      const form = await request.formData();
      const receipt = z.string().uuid().parse(form.get("receipt"));
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 4000000 || !file.size)
        throw new Error("Vyberte dokument do 4 MB.");
      const bytes = Buffer.from(await file.arrayBuffer());
      let storageBytes = bytes;
      let mime = file.type;
      if (mime === "application/pdf") {
        const doc = await PDFDocument.load(bytes);
        if (doc.getPageCount() > 20)
          throw new Error("PDF môže mať najviac 20 strán.");
      } else {
        const m = await sharp(bytes, { limitInputPixels: 24000000 }).metadata();
        const types: Record<string, string> = {
          jpeg: "image/jpeg",
          png: "image/png",
          webp: "image/webp",
        };
        mime = types[m.format ?? ""];
        if (!mime || (m.pages ?? 1) > 1)
          throw new Error("Podporované sú JPG, PNG, WEBP a PDF.");
      }
      if (mime !== "application/pdf") {
        storageBytes = await sharp(bytes, { limitInputPixels: 24000000 })
          .rotate()
          .resize({
            width: 2400,
            height: 3600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 88 })
          .toBuffer();
        mime = "image/webp";
      }
      const existing = await client
        .from("purchase_receipt_files")
        .select("id")
        .eq("receipt_id", receipt);
      if (existing.error)
        throw new Error("Aktivujte migráciu 007 pre účtenky.");
      if ((existing.data?.length ?? 0) >= 8)
        throw new Error("Jedna účtenka môže mať najviac 8 súborov.");
      const id = randomUUID(),
        path = `${user.id}/${receipt}/${id}`,
        hash = createHash("sha256").update(bytes).digest("hex");
      const uploaded = await client.storage
        .from("purchase-receipts")
        .upload(path, storageBytes, { contentType: mime });
      if (uploaded.error)
        throw new Error("Dokument sa nepodarilo bezpečne uložiť.");
      const attached = await client.rpc("attach_purchase_file", {
        p_id: id,
        p_receipt: receipt,
        p_hash: hash,
        p_mime: mime,
        p_filename: file.name.slice(0, 200),
        p_path: path,
      });
      if (attached.error) {
        await client.storage.from("purchase-receipts").remove([path]);
        throw new Error(
          "Dokument už je priložený alebo účtenka nie je pracovný návrh.",
        );
      }
      return Response.json({ ok: true });
    }
    const raw = await request.text();
    if (raw.length > 200000) throw new Error("Návrh je príliš veľký.");
    const body = JSON.parse(raw);
    const id = z.string().uuid().parse(body.id);
    if (body.action === "create") {
      const r = await client.rpc("create_purchase_draft", { p_id: id });
      if (r.error)
        throw new Error(
          "Účtenku sa nepodarilo vytvoriť. Skontrolujte migráciu 007.",
        );
      return Response.json({ ok: true });
    }
    if (body.action === "recognize") {
      if (body.consent !== true)
        throw new Error("Externé spracovanie vyžaduje váš súhlas.");
      const provider = receiptProvider();
      if (!provider)
        throw new Error(
          "Automatické rozpoznávanie nie je nakonfigurované. Použite manuálne zadanie.",
        );
      const r = await client
        .from("purchase_receipts")
        .select("status")
        .eq("id", id)
        .single();
      if (r.data?.status !== "draft")
        throw new Error("Rozpoznávať možno iba pracovný návrh.");
      const files = await client
        .from("purchase_receipt_files")
        .select("*")
        .eq("receipt_id", id);
      if (files.error || !files.data?.length)
        throw new Error("Najprv nahrajte dokument.");
      const job = await client.rpc("begin_purchase_import", { p_receipt: id });
      if (job.error)
        throw new Error(
          "Rozpoznávanie už prebieha alebo ste dosiahli limit 5 pokusov za 10 minút.",
        );
      const documents = [];
      try {
        for (const f of files.data) {
          const d = await client.storage
            .from("purchase-receipts")
            .download(f.path);
          if (d.error || !d.data) throw new Error("Dokument nie je dostupný.");
          documents.push({
            bytes: new Uint8Array(await d.data.arrayBuffer()),
            mime: f.mime,
            filename: f.filename,
          });
        }
        const extracted = await provider.extract(documents);
        await client.rpc("record_purchase_import", {
          p_job: job.data,
          p_status: "succeeded",
          p_result: extracted,
        });
        return Response.json({ data: extracted });
      } catch (e) {
        await client.rpc("record_purchase_import", {
          p_job: job.data,
          p_status: "failed",
          p_result: null,
        });
        throw e;
      }
    }
    const revision = z.number().int().nonnegative().parse(body.revision);
    if (body.action === "draft") {
      const parsed = receiptSchema
        .extend({
          merchant: z.string().max(160),
          items: receiptSchema.shape.items.element
            .extend({ name: z.string().max(200) })
            .array()
            .max(200),
        })
        .parse(body.data);
      const saved = await client.rpc("save_purchase_draft", {
        p_receipt: id,
        p_revision: revision,
        p_data: parsed,
      });
      if (saved.error)
        throw new Error(
          "Návrh sa medzičasom zmenil alebo ho nie je možné uložiť. Obnovte stránku.",
        );
      return Response.json({ ok: true });
    }
    const requestId = z.string().uuid().parse(body.requestId);
    let result;
    if (body.action === "cancel")
      result = await client.rpc("cancel_purchase", {
        p_receipt: id,
        p_request: requestId,
        p_revision: revision,
      });
    else if (body.action === "save")
      result = await client.rpc("save_purchase", {
        p_receipt: id,
        p_request: requestId,
        p_revision: revision,
        p_data: receiptSchema.parse(body.data),
        p_duplicate_confirmed: body.duplicateConfirmed === true,
      });
    else throw new Error("Neplatná operácia.");
    if (result.error) {
      const m = result.error.message;
      throw new Error(
        m.includes("POSSIBLE_DUPLICATE")
          ? "POSSIBLE_DUPLICATE"
          : m.includes("TOTAL_MISMATCH")
            ? "Súčet položiek nesedí s účtenkou."
            : m.includes("STALE_PURCHASE")
              ? "Účtenka sa medzičasom zmenila. Obnovte stránku."
              : "Nákup sa nepodarilo uložiť. Skontrolujte údaje a migráciu 007.",
      );
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? "Skontrolujte názvy, dátum, ceny a množstvá."
            : e instanceof Error
              ? e.message
              : "Spracovanie zlyhalo.",
      },
      { status: 400 },
    );
  }
}
