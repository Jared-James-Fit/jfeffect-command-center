/**
 * A pain report being filled in, kept on the phone until the review is saved
 * (pure apart from localStorage, tested): iOS can close the app mid-review,
 * and the spots someone rated shouldn't be lost with it. One per workout (and
 * per person viewing as a client), 24 hours at most; saving or discarding the
 * review forgets it.
 */
import type { PainPick } from "@/lib/pain/picks";

const PREFIX = "jf-pain-draft:v1:";
export const PAIN_DRAFT_MS = 24 * 60 * 60 * 1000;

export function painDraftKey(dayId: string, scheduledWorkoutId: string | null, actAs: string | null): string {
  return `${PREFIX}${dayId}:${scheduledWorkoutId ?? "-"}:${actAs ?? "-"}`;
}

function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function keepPainDraft(key: string, picks: PainPick[], now = Date.now()): void {
  try {
    store()?.setItem(key, JSON.stringify({ at: now, picks: picks.map(({ open: _o, ...p }) => p) }));
  } catch {
    // a full or blocked store only loses the backup
  }
}

export function forgetPainDraft(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // nothing to forget
  }
}

/** The kept draft while it's fresh and reads as picks, else null (and a stale or broken one is forgotten). */
export function readPainDraft(key: string, now = Date.now()): { at: number; picks: PainPick[] } | null {
  let raw: string | null = null;
  try {
    raw = store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    const ok = typeof v?.at === "number" && now - v.at <= PAIN_DRAFT_MS && Array.isArray(v.picks) && v.picks.every((p: any) => typeof p?.uid === "string" && typeof p?.region === "string");
    if (ok) return { at: v.at, picks: v.picks };
  } catch {
    // unreadable
  }
  forgetPainDraft(key);
  return null;
}
