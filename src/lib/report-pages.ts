// Paginate instead of silently accepting Supabase's default row limit.
export async function readAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { code?: string; message: string } | null;
  }>,
) {
  const data: T[] = [];
  for (let from = 0; from < 50000; from += 500) {
    const result = await page(from, from + 499);
    if (result.error) return { data: null, error: result.error };
    data.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) return { data, error: null };
  }
  return {
    data: null,
    error: {
      code: "REPORT_LIMIT",
      message: "Report exceeds safe page limit; narrow the date range.",
    },
  };
}
