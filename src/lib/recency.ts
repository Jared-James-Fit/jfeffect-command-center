/**
 * Conversation lists are ordered like iMessage and Instagram DMs: the chat
 * with the newest activity on top, whatever its status. Compared as times,
 * not strings, because timestamps arrive in more than one format ("Z" vs
 * "+00:00", with or without fractions) from tables, RPCs and realtime.
 */
export function timeOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isFinite(t)) return t;
  // Safari is stricter than Chrome: Postgres text ("2026-10-17 02:00:00.123456+00")
  // needs a "T", at most milliseconds and a "+00:00" offset.
  const fixed = Date.parse(
    iso.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d\d)$/, "$1:00"),
  );
  return Number.isFinite(fixed) ? fixed : 0;
}

/** Sort comparator: newest first; chats with no activity yet go last. */
export function newestFirst(a: string | null | undefined, b: string | null | undefined): number {
  return timeOf(b) - timeOf(a);
}

/** The latest of several activity times (message, review, update…). */
export function latestOf(...isos: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const iso of isos) if (iso && timeOf(iso) > timeOf(best)) best = iso;
  return best;
}
