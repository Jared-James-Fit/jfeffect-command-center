/**
 * Open a block's editor on one week: a link that knows which week needs work
 * (Missing program data's "Open") leaves the week here just before it
 * navigates, and the editor (BlockPayloadEditor) takes it once its weeks
 * load. Session storage, so it never outlives the tab, and it only counts
 * for a minute, so an editor opened later some other way starts as usual.
 */
const KEY = "pb.block-editor.focus-week:v1";
const FRESH_MS = 60_000;

export function focusBlockEditorWeek(weekIndex: number | null | undefined): void {
  if (typeof window === "undefined" || weekIndex == null || !Number.isFinite(weekIndex)) return;
  try { window.sessionStorage.setItem(KEY, JSON.stringify({ weekIndex, at: Date.now() })); } catch { /* private mode: the editor opens as usual */ }
}

/** The week a link asked for (week_index, 1-based), once: reading it clears it. */
export function takeBlockEditorWeek(now: number = Date.now()): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(KEY);
    const p = JSON.parse(raw);
    if (!Number.isFinite(p?.weekIndex) || !(now - Number(p?.at) <= FRESH_MS)) return null;
    return Number(p.weekIndex);
  } catch {
    return null;
  }
}
