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
 *
 * Bounded so it never becomes a cost: only clips the film leaves out for
 * their size, from the last CATCH_UP_DAYS, at most CATCH_UP_LAUNCHES tries
 * each on a phone, and a phone that found nothing looks again only after
 * CATCH_UP_EVERY_MS.
 */
import { supabase } from "@/integrations/supabase/client";
import { FILM_CLIP_MAX_BYTES, FILM_CLIP_MAX_S, FILM_MAX_SLIDES } from "@/lib/workout-film";

/** How far back a launch looks for clips the film leaves out for their size. */
export const CATCH_UP_DAYS = 14;
/** Launches a clip gets on a phone before it stops trying (a phone that can't make it never downloads it every launch). */
export const CATCH_UP_LAUNCHES = 3;
/** A phone that found nothing to catch up on looks again after this. */
export const CATCH_UP_EVERY_MS = 6 * 60 * 60_000;

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

const TRIES_KEY = "jf-feed-copy-catch-up";
const CHECKED_KEY = (uid: string) => `jf-feed-copy-checked:${uid}`;

function readTries(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(TRIES_KEY) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Counts this launch's try at a clip; false once it has had CATCH_UP_LAUNCHES (or storage is off: one try a launch). */
export function takeCatchUpLaunch(id: string): boolean {
  const tries = readTries();
  const n = tries[id] ?? 0;
  if (n >= CATCH_UP_LAUNCHES) return false;
  tries[id] = n + 1;
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
