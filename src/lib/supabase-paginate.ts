/**
 * Supabase (PostgREST) caps every REST response at 1,000 rows, silently —
 * `.limit(5000)` still returns 1,000 and no error. Anything that reads a
 * client's full training history must page through it, or long-term clients
 * lose their newest sets (charts stop, PRs vanish, "this month" reads 0).
 *
 * `build(from, to)` must return a query with a deterministic order (include a
 * unique tiebreaker such as `id`) and apply `.range(from, to)`.
 */
export const SUPABASE_PAGE_SIZE = 1000;

export async function fetchAllPages<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? SUPABASE_PAGE_SIZE;
  const maxRows = opts.maxRows ?? 100_000;
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

/** Splits a long `.in()` list so the request URL stays well under proxy limits. */
export function chunk<T>(items: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
