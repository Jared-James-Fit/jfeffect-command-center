/**
 * A "what's new" popup is news only to someone who used the app before the
 * thing it announces (pure, tested). An account made after that has had it
 * from its first day, so a brand-new member never gets "NEW: …" stacked on
 * top of their first-run questions (training setup, units, install).
 */
export function isNewsTo(accountCreatedAt: string | null | undefined, newSince: string): boolean {
  const created = accountCreatedAt ? Date.parse(accountCreatedAt) : NaN;
  // unknown age: keep showing it (the old behaviour)
  if (!Number.isFinite(created)) return true;
  return created < Date.parse(newSince);
}
