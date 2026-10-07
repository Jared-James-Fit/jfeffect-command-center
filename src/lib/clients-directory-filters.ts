/**
 * The filters on the admin Clients list. No UI imports, so the server function, the page and
 * the tests all share one definition of the keys.
 *
 * The database decides who matches each filter (the `flags` list inside admin_clients_directory).
 * With several selected a client must match ALL of them, so each extra filter narrows the list.
 * Keep this list in step with the `flags:begin` block of that function; a test compares them.
 */
export const DIRECTORY_FILTER_KEYS = [
  // Missing: things the client doesn't have yet.
  "no_contract",
  "no_payment",
  "no_program",
  "no_nutrition",
  "no_cardio",
  // Needs attention.
  "payment_issues",
  "payment_pending",
  "needs_review",
  "missed_workouts",
  "inactive",
  "program_ending",
  // Account.
  "needs_setup",
  "new_clients",
] as const;

export type DirectoryFilterKey = (typeof DIRECTORY_FILTER_KEYS)[number];

export function isDirectoryFilterKey(value: unknown): value is DirectoryFilterKey {
  return typeof value === "string" && (DIRECTORY_FILTER_KEYS as readonly string[]).includes(value);
}

/**
 * "no_contract,no_payment" -> ["no_contract", "no_payment"]. Unknown keys, repeats and the old
 * `status=all` are dropped, and the result is always in the list's own order, so the same
 * selection always produces the same query (and the same cache entry).
 */
export function parseFilterKeys(raw: string | null | undefined): DirectoryFilterKey[] {
  if (!raw) return [];
  const wanted = new Set(raw.split(",").map((part) => part.trim()));
  return DIRECTORY_FILTER_KEYS.filter((key) => wanted.has(key));
}

/** The inverse of parseFilterKeys; undefined for "nothing selected" so the URL stays clean. */
export function serializeFilterKeys(keys: readonly DirectoryFilterKey[]): string | undefined {
  const set = new Set(keys);
  const ordered = DIRECTORY_FILTER_KEYS.filter((key) => set.has(key));
  return ordered.length > 0 ? ordered.join(",") : undefined;
}

export function toggleFilterKey(
  keys: readonly DirectoryFilterKey[],
  key: DirectoryFilterKey,
): DirectoryFilterKey[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}

/**
 * What the URL asks for: the `flags` list plus the older single `status` value, so a bookmarked
 * `?status=needs_review` still works.
 */
export function filtersFromSearch(search: {
  flags?: string | null;
  status?: string | null;
}): DirectoryFilterKey[] {
  return parseFilterKeys([search.status, search.flags].filter(Boolean).join(","));
}

export type DirectoryCounts = Record<"all" | DirectoryFilterKey, number>;

export function emptyCounts(): DirectoryCounts {
  const counts = { all: 0 } as DirectoryCounts;
  for (const key of DIRECTORY_FILTER_KEYS) counts[key] = 0;
  return counts;
}
