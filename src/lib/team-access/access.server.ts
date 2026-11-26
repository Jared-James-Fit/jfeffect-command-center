/**
 * Server-only helpers for specialist reads. The one rule: before reading
 * anything about an athlete, ask the database with the caller's own login
 * (specialist_can_view: their role, their two-step sign-in, their record,
 * their membership, the athlete's access row and consent, the category).
 * Only then read with the service role, and only the columns that category
 * allows. Never import from client code.
 */
import type { ViewCategory } from "@/lib/team-access/presets";

export const MESSAGE_BUCKET = "message-attachments";
/** Signed media links live this long: long enough to watch, short enough to stop working soon after access ends. */
export const MEDIA_LINK_SECONDS = 15 * 60;

/**
 * Footage a specialist may see: a set video, or a lift sent in the coach chat
 * only once it's linked to a logged set. A chat video on its own is a message,
 * and messages are never theirs. (PostgREST `or` filter.)
 */
export const FOOTAGE_VIDEO_FILTER = "origin.eq.set,result_id.not.is.null";

/** True when a pl_set_videos row is footage a specialist may see (the same rule as the filter). */
export function isFootageVideo(v: {
  origin?: string | null;
  result_id?: string | null;
  deleted_at?: string | null;
}): boolean {
  return !v.deleted_at && (v.origin === "set" || !!v.result_id);
}

/**
 * A timestamp as a date-only instant on the athlete's own calendar day (noon
 * UTC), so code that reads the day from a Date gets the athlete's day on the
 * server and on any phone within ±11 hours of UTC.
 */
export function asAthleteDay(
  iso: string | null | undefined,
  timeZone: string | null | undefined,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${todayIn(timeZone, d)}T12:00:00.000Z`;
}

export async function serviceDb(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const CATEGORY_DENIED: Record<ViewCategory, string> = {
  footage: "You don't have access to this athlete's footage.",
  training: "You don't have access to this athlete's training.",
  performance: "You don't have access to this athlete's performance.",
};

/** Throws unless the signed-in specialist may see this athlete's category right now. */
export async function assertSpecialistCan(
  ctx: { supabase: any },
  clientId: string,
  category: ViewCategory,
): Promise<void> {
  const { data, error } = await ctx.supabase.rpc("specialist_can_view", {
    _client: clientId,
    _category: category,
  });
  if (error || data !== true) throw new Error(CATEGORY_DENIED[category]);
}

/** yyyy-mm-dd in an IANA zone (the athlete's own day), Winnipeg when unknown. */
export function todayIn(timeZone: string | null | undefined, now = new Date()): string {
  const zone = timeZone && timeZone.length >= 3 ? timeZone : "America/Winnipeg";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Signed links for storage paths in one request; a path that can't be signed is left out. */
export async function signPaths(
  db: any,
  paths: string[],
  seconds = MEDIA_LINK_SECONDS,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const part = unique.slice(i, i + 100);
    const { data } = await db.storage.from(MESSAGE_BUCKET).createSignedUrls(part, seconds);
    for (const row of (data ?? []) as Array<{
      path: string | null;
      signedUrl: string | null;
      error: string | null;
    }>) {
      if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
    }
  }
  return out;
}

/** Every page of a read past the 1,000-row cap. */
export async function readAll<T = any>(
  read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(error.message ?? "Couldn't read the records");
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/** Ids in chunks (a long `in.(…)` list is refused by the API). */
export function chunks<T>(items: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Has the owner kept this clip back from specialists? */
export async function footageHidden(db: any, setVideoId: string): Promise<boolean> {
  const { data } = await db
    .from("specialist_hidden_videos")
    .select("set_video_id")
    .eq("set_video_id", setVideoId)
    .maybeSingle();
  return !!data;
}
