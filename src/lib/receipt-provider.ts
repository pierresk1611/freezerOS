import { z } from "zod";
import { receiptSchema } from "./food-cost";
export const extractedSchema = receiptSchema.extend({
  currency: z.string().nullable(),
  merchant: z.string().nullable(),
  date: z.string().nullable(),
  items: receiptSchema.shape.items.min(0),
});
export interface ReceiptDocument {
  mime: string;
  bytes: Uint8Array;
  filename: string;
}
export interface ReceiptProvider {
  extract(
    documents: ReceiptDocument[],
  ): Promise<z.infer<typeof extractedSchema>>;
}
export function receiptProvider(): ReceiptProvider | null {
  const key = process.env.RECEIPT_OPENAI_API_KEY;
  if (!key) return null;
  return {
    async extract(documents) {
      const content = documents.map((d) => {
        const data = Buffer.from(d.bytes).toString("base64");
        return d.mime === "application/pdf"
          ? {
              type: "input_file",
              filename: d.filename,
              file_data: `data:application/pdf;base64,${data}`,
            }
          : {
              type: "input_image",
              image_url: `data:${d.mime};base64,${data}`,
              detail: "high",
            };
      });
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(50000),
        body: JSON.stringify({
          model: process.env.RECEIPT_OPENAI_MODEL || "gpt-4.1-mini",
          store: false,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "Extract this Czech/Slovak purchase receipt into JSON. Multiple images may overlap: return each physical receipt line once, but preserve identical independently purchased lines. Do not invent unreadable values: use null. Monetary fields are integer Czech haléře, total_minor is the final paid line total AFTER discount, discount_minor is the informational discount amount (do not subtract twice). Refund totals negative. Include transport and non-food goods with categories fees/equipment. Extract the actual printed ISO currency or null if unknown. Never relabel another currency as CZK. Dates YYYY-MM-DD. Confidence 0..1. ingredient_name null unless directly clear; never invent weights. Do not convert foreign currencies. All uncertain fields null. Use exact printed item names.",
                },
                ...content,
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "receipt",
              strict: true,
              schema: z.toJSONSchema(extractedSchema),
            },
          },
        }),
      });
      if (!response.ok)
        throw new Error(
          "Poskytovateľ rozpoznávania odmietol požiadavku. Skontrolujte konfiguráciu alebo zadajte údaje ručne.",
        );
      const result = await response.json();
      const output = (result.output ?? [])
        .flatMap(
          (x: { content?: { type: string; text?: string }[] }) =>
            x.content ?? [],
        )
        .find((x: { type: string }) => x.type === "output_text");
      if (!output?.text)
        throw new Error("Rozpoznávanie nevrátilo použiteľné údaje.");
      const extracted = extractedSchema.parse(JSON.parse(output.text));
      if (extracted.currency !== "CZK")
        throw new Error(
          "Mena dokladu nie je spoľahlivo rozpoznaná ako CZK. Bez overeného prepočtu nemožno nákup započítať.",
        );
      return extracted;
    },
  };
}
