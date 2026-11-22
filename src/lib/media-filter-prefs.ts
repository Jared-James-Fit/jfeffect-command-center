/**
 * A person's default filter (Nov 22 2026): "Save as default" on a photo or
 * clip in the post composer or the story camera keeps that filter, its
 * strength and its adjustments on their account (`media_filter_prefs`, own
 * row), one for posts and one for stories, so every new photo or clip starts
 * with it on any device. Changing one post's filter never changes it; "Remove
 * default" puts new media back to Original. A copy on the device paints the
 * first frame right; the newer of the two wins, like the calendar's choices.
 * Progress check-ins and anything else outside Crew never read it.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cleanGrade, type MediaGrade } from "@/lib/media-grade";

export type FilterKind = "post" | "story";
export type FilterDefaults = { post: MediaGrade | null; story: MediaGrade | null; updatedAt?: string };

const CACHE_KEY = "jf.media-filter-defaults.v1";
const EMPTY: FilterDefaults = { post: null, story: null };
const db = supabase as any;

/** Only what the app understands (a known filter, sane numbers); never a picture's measurements. */
export function sanitizeDefaults(raw: unknown): FilterDefaults {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: FilterDefaults = { post: cleanGrade(r.post), story: cleanGrade(r.story) };
  if (typeof r.updatedAt === "string" && !Number.isNaN(Date.parse(r.updatedAt))) out.updatedAt = r.updatedAt;
  return out;
}

/** The newer of the device's and the account's copy (the account's on a tie). */
export function newerDefaults(local: FilterDefaults, remote: FilterDefaults | null): FilterDefaults {
  if (!remote) return local;
  if (!local.updatedAt) return remote;
  if (!remote.updatedAt) return local;
  return Date.parse(local.updatedAt) > Date.parse(remote.updatedAt) ? local : remote;
}

/** Same filter, strength and adjustments (a picture's own measurements aside). */
export function sameGrade(a: MediaGrade | null | undefined, b: MediaGrade | null | undefined): boolean {
  const x = cleanGrade(a);
  const y = cleanGrade(b);
  if (!x || x.filter === "original") return !y || (y.filter === "original" && !y.adjust);
  return JSON.stringify(x) === JSON.stringify(y);
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readCache(userId: string | null): FilterDefaults {
  try {
    const parsed = JSON.parse(storage()?.getItem(CACHE_KEY) ?? "null");
    if (parsed && parsed.owner === userId) return sanitizeDefaults(parsed.prefs);
  } catch {
    /* nothing kept */
  }
  return EMPTY;
}

function writeCache(userId: string | null, prefs: FilterDefaults) {
  try {
    storage()?.setItem(CACHE_KEY, JSON.stringify({ owner: userId, prefs }));
  } catch {
    /* private mode: this visit only */
  }
}

async function saveToAccount(userId: string, prefs: FilterDefaults): Promise<boolean> {
  const { updatedAt, ...rest } = prefs;
  for (let i = 0; i < 2; i++) {
    const { error } = await db.from("media_filter_prefs").upsert({ user_id: userId, prefs: rest, updated_at: updatedAt ?? new Date().toISOString() }, { onConflict: "user_id" });
    if (!error) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  // still on the device; the next load sees it's newer and saves it then
  return false;
}

/** The person's saved defaults, and a way to change one. `enabled: false` (a coach previewing a client): nothing read or saved. */
export function useFilterDefaults(enabled = true): {
  defaults: FilterDefaults;
  setDefault: (kind: FilterKind, grade: MediaGrade | null) => void;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const key = ["media-filter-defaults", userId] as const;
  const { data } = useQuery<FilterDefaults>({
    queryKey: key,
    enabled: !!userId && enabled,
    initialData: () => readCache(userId),
    initialDataUpdatedAt: 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data: row } = await db.from("media_filter_prefs").select("prefs, updated_at").eq("user_id", userId).maybeSingle();
      const remote = row ? { ...sanitizeDefaults(row.prefs), updatedAt: row.updated_at as string } : null;
      const local = readCache(userId);
      const winner = newerDefaults(local, remote);
      writeCache(userId, winner);
      if (userId && winner === local && local.updatedAt && (!remote || local.updatedAt !== remote.updatedAt)) void saveToAccount(userId, local);
      return winner;
    },
  });
  const setDefault = (kind: FilterKind, grade: MediaGrade | null) => {
    if (!enabled) return;
    const current = qc.getQueryData<FilterDefaults>(key) ?? data ?? readCache(userId);
    const clean = grade ? cleanGrade(grade) : null;
    const next: FilterDefaults = { ...current, [kind]: clean && clean.filter === "original" && !clean.adjust ? null : clean, updatedAt: new Date().toISOString() };
    qc.setQueryData(key, next);
    writeCache(userId, next);
    if (userId) void saveToAccount(userId, next);
  };
  return { defaults: enabled ? (data ?? EMPTY) : EMPTY, setDefault };
}
