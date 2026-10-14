import { userDb } from "@/lib/supabase";
import { notFound } from "next/navigation";
import ReceiptEditor from "../../receipt-editor";
import { emptyItem, type Receipt } from "@/lib/food-cost";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { client } = await userDb();
  const { data: r } = await client
    .from("purchase_receipts")
    .select("*,purchase_merchants(name),purchase_receipt_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();
  const f = await client
    .from("purchase_receipt_files")
    .select("*")
    .eq("receipt_id", id);
  const documents = await Promise.all(
    (f.data ?? []).map(async (x) => {
      const s = await client.storage
        .from("purchase-receipts")
        .createSignedUrl(x.path, 3600);
      return {
        id: x.id,
        url: s.data?.signedUrl ?? "",
        mime: x.mime,
        filename: x.filename,
      };
    }),
  );
  const products = await client
    .from("purchase_product_aliases")
    .select("alias,purchase_products(category,ingredient_name,name)");
  const aliases = Object.fromEntries(
    (products.data ?? []).map((x) => [
      x.alias,
      {
        ...x.purchase_products,
        product_name: (x.purchase_products as unknown as { name: string })
          ?.name,
      },
    ]),
  );
  const jobs = await client
    .from("purchase_import_jobs")
    .select("result")
    .eq("receipt_id", id)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1);
  const extracted = jobs.data?.[0]?.result;
  const initial: Receipt = r.draft_data ?? {
    merchant: r.purchase_merchants?.name ?? extracted?.merchant ?? "",
    date:
      r.receipt_date ??
      (extracted
        ? (extracted.date ?? "")
        : new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Prague",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date())),
    order_number: r.order_number ?? extracted?.order_number ?? "",
    currency: "CZK",
    total_minor: r.total_minor ?? extracted?.total_minor ?? null,
    items: r.purchase_receipt_items.length
      ? r.purchase_receipt_items.sort(
          (a: { position: number }, b: { position: number }) =>
            a.position - b.position,
        )
      : extracted?.items?.length
        ? extracted.items
        : [emptyItem()],
  };
  return (
    <ReceiptEditor
      id={id}
      revision={r.revision}
      status={r.status}
      initial={initial}
      documents={documents}
      aliases={aliases}
      configured={Boolean(process.env.RECEIPT_OPENAI_API_KEY)}
    />
  );
}
