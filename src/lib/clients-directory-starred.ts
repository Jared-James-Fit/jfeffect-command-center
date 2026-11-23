/**
 * The Clients list's Starred filter (Nov 23 2026), pure so the page and the
 * tests share it.
 *
 * Stars are the coach's own (client-stars.ts), not something the directory's
 * database function knows, so with Starred on the page reads the list whole
 * (the same function, page by page at its 100-row maximum: one call for a
 * coaching business) with every other filter, search and sort exactly as
 * picked, then:
 *
 *   only   keeps the starred clients, in the chosen sort
 *   first  moves the starred clients to the top, everyone else after them,
 *          each in the chosen sort
 *
 * and pages that in the app. The choice is the address's (`?starred=`), so it
 * lasts the visit and never changes the default sort or filters.
 */

export type StarredMode = "only" | "first";

export function starredModeFromSearch(raw: unknown): StarredMode | null {
  return raw === "only" || raw === "first" ? raw : null;
}

/** The rows the list shows for a mode: only the starred, or the starred first; the sort kept inside each part. */
export function arrangeStarred<T extends { id: string }>(rows: readonly T[], starred: ReadonlySet<string>, mode: StarredMode): T[] {
  const mine = rows.filter((r) => starred.has(r.id));
  if (mode === "only") return mine;
  return [...mine, ...rows.filter((r) => !starred.has(r.id))];
}

/** One page of an arranged list (1-based), and how many there are in all. */
export function pageOf<T>(rows: readonly T[], page: number, size: number): T[] {
  const p = Math.max(1, Math.floor(page) || 1);
  return rows.slice((p - 1) * size, p * size);
}

/** The most the directory function returns in one call (its input schema's cap). */
export const DIRECTORY_MAX_PAGE = 100;

/** How many calls reading the whole list may take before it stops (10,000 clients). */
const MAX_CALLS = 100;

/**
 * Every row the directory function would list for these filters, read page by
 * page. `read` is one call (page, size); the first answer's counts and total
 * are kept.
 */
export async function readWholeDirectory<R, C>(
  read: (page: number, size: number) => Promise<{ rows: R[]; total: number; counts: C }>,
): Promise<{ rows: R[]; total: number; counts: C }> {
  const first = await read(1, DIRECTORY_MAX_PAGE);
  const rows = [...first.rows];
  let page = 1;
  while (rows.length < first.total && page < MAX_CALLS) {
    page += 1;
    const next = await read(page, DIRECTORY_MAX_PAGE);
    if (!next.rows.length) break;
    rows.push(...next.rows);
  }
  return { rows, total: first.total, counts: first.counts };
}
