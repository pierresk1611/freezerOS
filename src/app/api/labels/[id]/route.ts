import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { z } from "zod";
import { packageLabel } from "@/lib/package-label";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = (await params).id;
  if (!z.string().uuid().safeParse(id).success)
    return new NextResponse("Balíček neexistuje.", { status: 404 });
  const client = await db();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return new NextResponse("Prihláste sa.", { status: 401 });
  const { data: p, error } = await client
    .from("inventory_packages")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !p)
    return new NextResponse("Balíček neexistuje.", { status: 404 });
  const format =
    request.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "png";
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : new URL(request.url).protocol + "//" + request.headers.get("host"));
  const bytes = await packageLabel(p, origin, format);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "image/png",
      "Content-Disposition": `attachment; filename="freezer-${id}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
