/**
 * Feed copies the phone catches up on. A set video's 720p copy for Crew is
 * normally made right after the coach gets the clip, from the file the athlete
 * picked (uploader.ts). Clips sent before copies existed (Nov 12 2026), or
 * whose copy never got made (the app closed first), are left out of the
 * workout film whenever they're over a workout post's 50 MB: an iPhone's 4K
 * original is ~50-70 MB for 30 s. On a launch the athlete's phone looks for
 * its own recent ones (one small read, after the app has painted), fetches
 * each from storage when its turn comes and makes the copy the same way, and
 * the film post picks the clip up (set_video_feed_copy → postWorkoutFilmFn).
 * It also looks when the app comes back on screen (an iPhone's home-screen
 * app is rarely launched again, only brought back) and when the workout's
 * film says a clip is waiting on its copy (FEED_COPY_CATCH_UP_EVENT).
 *
 * Bounded so it never becomes a cost: only clips the film leaves out for
 * their size, from the last CATCH_UP_DAYS, one try a clip each time the app
 * is opened and at most CATCH_UP_LAUNCHES of those on a phone, and a phone
 * that found nothing looks again only after CATCH_UP_EVERY_MS, unless a clip
 * that needs a copy was sent since (clearCatchUpChecked).
 *
 * Nov 18 2026: Jared's Pull Up (58.5 MB, 31 s) went up at 7:21 AM and the
 * app was left before its copy was made; a phone that had looked in the
 * hours before and found nothing waited up to 6 hours, and only for a fresh
 * launch, so his Monday film showed 5 of his 6 sets.
 */
import { supabase } from "@/integrations/supabase/client";
import { FILM_CLIP_MAX_BYTES, FILM_CLIP_MAX_S, FILM_MAX_SLIDES } from "@/lib/workout-film";
import { FEED_COPY_CATCH_UP_EVENT } from "@/lib/set-videos/catch-up-event";

export { FEED_COPY_CATCH_UP_EVENT };

/** How far back a launch looks for clips the film leaves out for their size. */
export const CATCH_UP_DAYS = 14;
/** Launches a clip gets on a phone before it stops trying (a phone that can't make it never downloads it every launch). */
export const CATCH_UP_LAUNCHES = 3;
/** A phone that found nothing to catch up on looks again after this (one small read). */
export const CATCH_UP_EVERY_MS = 15 * 60_000;

/** Ask the phone to make any copies it's missing now (the film row, while a clip waits on one). */
export function askFeedCopyCatchUp(uid: string) {
  clearCatchUpChecked(uid);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FEED_COPY_CATCH_UP_EVENT));
}

export type CatchUpClip = {
  id: string;
  client_id: string;
  storage_path: string;
  size_bytes: number | string | null;
  duration_s: number | string | null;
  mime: string | null;
};

/**
 * The job id a set video was stored under (`<client>/set-videos/<job>.<ext>`),
 * which names its copy (`<job>-feed.<ext>`, the only name set_video_feed_copy
 * takes); null for anything else (never a copy itself).
 */
export function catchUpJobId(clientId: string, storagePath: string): string | null {
  const m = /^([^/]+)\/set-videos\/([A-Za-z0-9_-]+)\.(mp4|mov|webm)$/i.exec(storagePath);
  if (!m || m[1] !== clientId || /-feed$/.test(m[2])) return null;
  return m[2];
}

/** The film leaves it out for its size alone, so a 720p copy puts it on (one too long stays out either way). */
export function leftOutForSize(c: Pick<CatchUpClip, "size_bytes" | "duration_s">): boolean {
  const bytes = Number(c.size_bytes);
  const secs = c.duration_s == null ? null : Number(c.duration_s);
  return Number.isFinite(bytes) && bytes > FILM_CLIP_MAX_BYTES && (secs == null || (Number.isFinite(secs) && secs <= FILM_CLIP_MAX_S + 1.5));
}

// v2 (Nov 18 2026): a phone that looked under the 6-hour rule looks again at once
const TRIES_KEY = "jf-feed-copy-catch-up-v2";
const CHECKED_KEY = (uid: string) => `jf-feed-copy-checked-v2:${uid}`;
/** Clips given their try in this app open (a return to the app never spends another). */
const takenThisOpen = new Set<string>();

function readTries(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(TRIES_KEY) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * Counts this app open's try at a clip: false when it already had one in this
 * open, or once it has had CATCH_UP_LAUNCHES (storage off: one try an open).
 */
export function takeCatchUpLaunch(id: string): boolean {
  if (takenThisOpen.has(id)) return false;
  const tries = readTries();
  const n = tries[id] ?? 0;
  if (n >= CATCH_UP_LAUNCHES) return false;
  tries[id] = n + 1;
  takenThisOpen.add(id);
  try {
    localStorage.setItem(TRIES_KEY, JSON.stringify(tries));
  } catch {
    /* private window: still one try per launch */
  }
  return true;
}

/** This phone looked recently and found nothing. */
export function catchUpCheckedRecently(uid: string, now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(CHECKED_KEY(uid)));
    return Number.isFinite(at) && at > 0 && now - at < CATCH_UP_EVERY_MS;
  } catch {
    return false;
  }
}

/** Nothing to do on this phone for now: the next look is CATCH_UP_EVERY_MS away. */
export function markCatchUpChecked(uid: string) {
  try {
    localStorage.setItem(CHECKED_KEY(uid), String(Date.now()));
  } catch {
    /* fine: it just looks again next launch */
  }
}

/** A clip that needs a copy was just sent: the next look happens at once, whatever was found before. */
export function clearCatchUpChecked(uid: string) {
  try {
    localStorage.removeItem(CHECKED_KEY(uid));
  } catch {
    /* fine */
  }
}

/** For tests: forget this open's tries. */
export function resetCatchUpOpen() {
  takenThisOpen.clear();
}

/** The athlete's own recent set videos the film leaves out for their size, with no copy yet (one small read). */
export async function findCatchUpClips(uid: string): Promise<CatchUpClip[]> {
  if (catchUpCheckedRecently(uid)) return [];
  const since = new Date(Date.now() - CATCH_UP_DAYS * 86_400_000).toISOString();
  const { data, error } = await (supabase as any)
    .from("pl_set_videos")
    .select("id, client_id, storage_path, size_bytes, duration_s, mime")
    .eq("uploaded_by", uid)
    .is("deleted_at", null)
    .is("feed_path", null)
    // a warm-up's clip (set 0) is never in the film
    .gt("set_index", 0)
    .gt("size_bytes", FILM_CLIP_MAX_BYTES)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(FILM_MAX_SLIDES * 2);
  if (error) return [];
  const clips = ((data ?? []) as CatchUpClip[]).filter(
    (c) => leftOutForSize(c) && catchUpJobId(c.client_id, c.storage_path),
  );
  if (!clips.length) markCatchUpChecked(uid);
  return clips;
}
