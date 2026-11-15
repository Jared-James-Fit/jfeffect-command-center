/**
 * The coach's calendar choices, remembered on their account so they follow
 * them across phone and desktop: the Calendar page's view (Month / Week /
 * Day / List), the Home card's view (Day / Week / Month), and Coaching vs
 * + Google. A copy on the device makes the first paint right (no flash of
 * the default), and the account copy wins when it's newer (changed on the
 * other device). Whichever was changed last wins, as for the theme.
 *
 * Kept in its own table (`calendar_view_prefs`), not `user_preferences`: a
 * new row there would carry a default theme and could flip someone's dark
 * mode on their next launch.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type BoardView = "month" | "week" | "day" | "upcoming";
export type HomeView = "day" | "week" | "month";

export type CalendarPrefs = {
  boardView?: BoardView;
  homeView?: HomeView;
  includeGoogle?: boolean;
  /** When these were last changed (ISO), to pick the newer of device and account. */
  updatedAt?: string;
};

const BOARD_VIEWS: BoardView[] = ["month", "week", "day", "upcoming"];
const HOME_VIEWS: HomeView[] = ["day", "week", "month"];
export const CALENDAR_PREFS_CACHE_KEY = "jf.calendar.prefs";
/** Before this, only the Google switch was remembered, on the device. */
export const LEGACY_GOOGLE_KEY = "admin.calendar.includeGoogle";

const db = supabase as any;

/** Only values the app understands; anything else is dropped. */
export function sanitizePrefs(raw: unknown): CalendarPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: CalendarPrefs = {};
  if (BOARD_VIEWS.includes(r.boardView as BoardView)) out.boardView = r.boardView as BoardView;
  if (HOME_VIEWS.includes(r.homeView as HomeView)) out.homeView = r.homeView as HomeView;
  if (typeof r.includeGoogle === "boolean") out.includeGoogle = r.includeGoogle;
  if (typeof r.updatedAt === "string" && !Number.isNaN(Date.parse(r.updatedAt))) out.updatedAt = r.updatedAt;
  return out;
}

/** The newer of the device's and the account's copy (the account's on a tie). */
export function pickNewer(local: CalendarPrefs, remote: CalendarPrefs | null): CalendarPrefs {
  if (!remote) return local;
  if (!local.updatedAt) return remote;
  if (!remote.updatedAt) return local;
  return Date.parse(local.updatedAt) > Date.parse(remote.updatedAt) ? local : remote;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The device copy, for this account only (a shared device never hands one
 * person's choices to the next). The old Google-only key seeds the switch.
 */
export function readCachedPrefs(userId: string | null): CalendarPrefs {
  const ls = storage();
  if (!ls) return {};
  let prefs: CalendarPrefs = {};
  try {
    const parsed = JSON.parse(ls.getItem(CALENDAR_PREFS_CACHE_KEY) ?? "null");
    if (parsed && (parsed.owner === userId || parsed.owner == null)) prefs = sanitizePrefs(parsed.prefs);
  } catch {
    prefs = {};
  }
  if (prefs.includeGoogle === undefined) {
    const legacy = ls.getItem(LEGACY_GOOGLE_KEY);
    if (legacy === "1" || legacy === "0") prefs.includeGoogle = legacy === "1";
  }
  return prefs;
}

function writeCache(userId: string | null, prefs: CalendarPrefs) {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(CALENDAR_PREFS_CACHE_KEY, JSON.stringify({ owner: userId, prefs }));
    if (prefs.includeGoogle !== undefined) ls.setItem(LEGACY_GOOGLE_KEY, prefs.includeGoogle ? "1" : "0");
  } catch {
    /* private mode: remembered for this visit only */
  }
}

async function saveToAccount(userId: string, prefs: CalendarPrefs): Promise<void> {
  const { updatedAt, ...rest } = prefs;
  for (let i = 0; i < 2; i++) {
    const { error } = await db
      .from("calendar_view_prefs")
      .upsert({ user_id: userId, prefs: rest, updated_at: updatedAt ?? new Date().toISOString() }, { onConflict: "user_id" });
    if (!error) return;
    await new Promise((r) => setTimeout(r, 800));
  }
  // Still on the device; the next load sees the device copy is newer and saves it then.
}

/**
 * One shared copy per account (React Query), so the Home card and the
 * Calendar page always agree, even mid-visit.
 */
export function useCalendarPrefs(): { prefs: CalendarPrefs; setPrefs: (patch: Omit<CalendarPrefs, "updatedAt">) => void } {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const key = ["calendar-prefs", userId] as const;

  const { data } = useQuery<CalendarPrefs>({
    queryKey: key,
    enabled: !!userId,
    initialData: () => readCachedPrefs(userId),
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: row } = await db.from("calendar_view_prefs").select("prefs, updated_at").eq("user_id", userId).maybeSingle();
      const remote = row ? { ...sanitizePrefs(row.prefs), updatedAt: row.updated_at as string } : null;
      // Read the device copy now, not before the fetch: a tap during it counts.
      const local = readCachedPrefs(userId);
      const winner = pickNewer(local, remote);
      writeCache(userId, winner);
      if (userId && winner === local && local.updatedAt && (!remote || local.updatedAt !== remote.updatedAt)) {
        void saveToAccount(userId, local);
      }
      return winner;
    },
  });

  const setPrefs = (patch: Omit<CalendarPrefs, "updatedAt">) => {
    const current = qc.getQueryData<CalendarPrefs>(key) ?? data ?? readCachedPrefs(userId);
    const next: CalendarPrefs = { ...current, ...patch, updatedAt: new Date().toISOString() };
    qc.setQueryData(key, next);
    writeCache(userId, next);
    if (userId) void saveToAccount(userId, next);
  };

  return { prefs: data ?? {}, setPrefs };
}
