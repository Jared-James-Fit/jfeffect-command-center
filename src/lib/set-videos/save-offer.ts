/**
 * "Save N videos to device" on a finished workout's recap is offered at most
 * once per workout (pure, tested in workout-completion-screen.test.ts): the first
 * time the recap shows with clips filmed in the app that aren't saved, never
 * during the review, and never again when the finished workout is reopened.
 * Remembered per login on the phone (the clips themselves are only on this
 * phone, so the offer belongs to it too), pruned after `KEEP_MS`.
 */
export const SAVE_OFFER_KEY = "jf-video-save-offer-v1";
export const KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

type KV = Pick<Storage, "getItem" | "setItem">;
type Offers = Record<string, number>;

function readAll(storage: KV): Record<string, Offers> {
  try {
    const raw = storage.getItem(SAVE_OFFER_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** This workout's offer has been shown (or dismissed) on this phone for this login. */
export function wasOffered(storage: KV, userId: string, workoutKey: string): boolean {
  return typeof readAll(storage)[userId]?.[workoutKey] === "number";
}

/** Note the offer as shown; old ones are dropped. */
export function markOffered(storage: KV, userId: string, workoutKey: string, now = Date.now()): void {
  const all = readAll(storage);
  const mine: Offers = { ...(all[userId] ?? {}), [workoutKey]: now };
  const kept = Object.entries(mine)
    .filter(([, at]) => typeof at === "number" && now - at < KEEP_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ENTRIES);
  all[userId] = Object.fromEntries(kept);
  try {
    storage.setItem(SAVE_OFFER_KEY, JSON.stringify(all));
  } catch {
    // storage full or blocked: the offer just may show once more
  }
}

/**
 * Whether the recap offers saving now: clips to save, the athlete's own
 * workout on their phone, and never offered for this workout before.
 */
export function shouldOfferSave(o: { eligible: number; viewingAsClient: boolean; phone: boolean; offeredBefore: boolean }): boolean {
  return o.eligible > 0 && !o.viewingAsClient && o.phone && !o.offeredBefore;
}

/** "Save 1 video to device", "Save 7 videos to device". */
export function saveVideosLabel(n: number): string {
  return `Save ${n} ${n === 1 ? "video" : "videos"} to device`;
}
