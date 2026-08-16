/**
 * Local-only shopping state for the weekly grocery list.
 *
 * Keyed by active nutrition target id + selected week start + normalized item
 * identity. This NEVER touches nutrition targets, plan notes, food logs,
 * recipes, macros or any prescription data — it is browser-local only.
 */

const PREFIX = "jfeffect.grocery.checked.v1";

export function groceryStateKey(targetId: string, weekStartISO: string): string {
  return `${PREFIX}:${targetId}:${weekStartISO}`;
}

export function readCheckedIdentities(targetId: string, weekStartISO: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(groceryStateKey(targetId, weekStartISO));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeCheckedIdentities(targetId: string, weekStartISO: string, identities: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      groceryStateKey(targetId, weekStartISO),
      JSON.stringify(Array.from(new Set(identities))),
    );
  } catch {
    /* storage unavailable — shopping ticks are best-effort */
  }
}

export function clearCheckedIdentities(targetId: string, weekStartISO: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(groceryStateKey(targetId, weekStartISO));
  } catch {
    /* ignore */
  }
}
