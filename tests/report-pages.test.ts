import { it, expect } from "vitest";
import { readAll } from "../src/lib/report-pages";
it("financial reports paginate beyond the default server cap", async () => {
  const rows = Array.from({ length: 1250 }, (_, i) => ({ id: i }));
  const r = await readAll(async (a, b) => ({
    data: rows.slice(a, b + 1),
    error: null,
  }));
  expect(r.data).toHaveLength(1250);
  expect(r.error).toBeNull();
});
it("partial query is never presented as a complete financial total", async () => {
  const r = await readAll(async (a) =>
    a === 0
      ? { data: Array(500).fill(1), error: null }
      : { data: null, error: { message: "Connection failed" } },
  );
  expect(r.data).toBeNull();
  expect(r.error).not.toBeNull();
});
