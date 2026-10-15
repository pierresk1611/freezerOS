import schema from "../../../../../docs/meal-prep-import.schema.json";
import example from "../../../../../docs/meal-prep-import.example.json";
import { prepPrompt } from "@/lib/meal-prep";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  if (asset === "prompt")
    return new Response(prepPrompt, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const value =
    asset === "schema" ? schema : asset === "example" ? example : null;
  return value
    ? Response.json(value, {
        headers: {
          "Content-Disposition": `attachment; filename="meal-prep-import.${asset === "schema" ? "schema" : "example"}.json"`,
        },
      })
    : new Response("Not found", { status: 404 });
}
