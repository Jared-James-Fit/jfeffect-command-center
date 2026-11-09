/**
 * A client's bodyweight as their coach sees it: every weigh-in they logged in
 * the app (`progress_bodyweight`, by their login) plus the coach-entered
 * metrics from before it (`progress_metrics`, by client, last written
 * Aug 19 2026), one entry per day with the app's winning a tie
 * (`mergeBodyweightSeries`, the same reading the client's own screens use).
 *
 * The tile math is pure so it's tested: the 7-day average and its change
 * against the 7 days before read the trend, never two single weigh-ins.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  mergeBodyweightSeries,
  type BodyweightPoint,
  type CanonicalBodyweightRow,
  type LegacyBodyweightMetricRow,
  type WeightUnit,
} from "@/lib/bodyweight";

export type ClientBodyweightEntry = BodyweightPoint & {
  id: string;
  source: "progress_bodyweight" | "progress_metrics";
};

export type ClientBodyweight = {
  /** The client's login, or null when they don't have one yet (coach-entered only). */
  userId: string | null;
  /** Oldest first. */
  entries: ClientBodyweightEntry[];
};

export const clientBodyweightQueryKey = (clientId: string) => ["client-bodyweight", clientId] as const;

const PAGE = 1000;

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** Every weigh-in on file for a client, both sources, read whole (paged). */
export async function loadClientBodyweight(clientId: string): Promise<ClientBodyweight> {
  const { data: client, error } = await supabase.from("clients").select("user_id").eq("id", clientId).maybeSingle();
  if (error) throw error;
  const userId = (client?.user_id as string | null) ?? null;

  const [canonical, legacy] = await Promise.all([
    userId
      ? readAll<CanonicalBodyweightRow>((from, to) =>
          supabase
            .from("progress_bodyweight")
            .select("id, logged_date, weight_value, weight_unit, note")
            .eq("user_id", userId)
            .order("logged_date", { ascending: false })
            .order("id", { ascending: true })
            .range(from, to) as never,
        )
      : Promise.resolve([] as CanonicalBodyweightRow[]),
    readAll<LegacyBodyweightMetricRow>((from, to) =>
      supabase
        .from("progress_metrics")
        .select("id, entry_date, bodyweight, bodyweight_unit, notes")
        .eq("client_id", clientId)
        .not("bodyweight", "is", null)
        .order("entry_date", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as never,
    ),
  ]);

  const entries = mergeBodyweightSeries(canonical, legacy).filter(
    (p): p is ClientBodyweightEntry =>
      !!p.id && Number.isFinite(p.value) && p.value > 0 && (p.source === "progress_bodyweight" || p.source === "progress_metrics"),
  );
  return { userId, entries };
}

const DAY_MS = 86_400_000;
const dayNumber = (ymd: string) => Math.round(Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) / DAY_MS);

export function inUnit(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  return from === "lb" ? value * 0.45359237 : value / 0.45359237;
}

export type BodyweightTiles = {
  latest: { value: number; date: string } | null;
  /** Mean of the weigh-ins in the 7 days up to today (today included). */
  avg7: number | null;
  /** How many weigh-ins that average is from. */
  count7: number;
  /** avg7 minus the mean of the 7 days before it; null unless both weeks have one. */
  weeklyChange: number | null;
};

/**
 * The coach's four tiles, in `unit`. `today` is the coach's calendar day
 * (YYYY-MM-DD); entries dated after it (a time-zone edge) still count as this week.
 */
export function bodyweightTiles(entries: ReadonlyArray<BodyweightPoint>, unit: WeightUnit, today: string): BodyweightTiles {
  const pts = entries
    .filter((p) => Number.isFinite(p.value) && p.value > 0)
    .map((p) => ({ date: p.date, day: dayNumber(p.date), value: inUnit(p.value, p.unit, unit) }))
    .sort((a, b) => a.day - b.day);
  if (!pts.length) return { latest: null, avg7: null, count7: 0, weeklyChange: null };

  const last = pts[pts.length - 1];
  const t = dayNumber(today);
  const mean = (xs: typeof pts) => (xs.length ? xs.reduce((s, p) => s + p.value, 0) / xs.length : null);
  const thisWeek = pts.filter((p) => p.day > t - 7);
  const lastWeek = pts.filter((p) => p.day > t - 14 && p.day <= t - 7);
  const avg7 = mean(thisWeek);
  const prev = mean(lastWeek);
  return {
    latest: { value: last.value, date: last.date },
    avg7,
    count7: thisWeek.length,
    weeklyChange: avg7 != null && prev != null ? avg7 - prev : null,
  };
}

/** One row per weigh-in, newest first, for the coach's CSV export. */
export function bodyweightCsv(entries: ReadonlyArray<ClientBodyweightEntry>): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["date,bodyweight,unit,note"];
  for (const e of [...entries].sort((a, b) => b.date.localeCompare(a.date))) {
    lines.push([e.date, String(e.value), e.unit, esc(e.note ?? "")].join(","));
  }
  return lines.join("\n");
}

/** What a coach's change to a client's weigh-ins must refresh, theirs and the client's. */
export function clientBodyweightRefreshKeys(clientId: string, userId: string | null): ReadonlyArray<readonly unknown[]> {
  return [
    clientBodyweightQueryKey(clientId),
    ["progress-metrics", clientId],
    ["analytics-bodyweight", clientId],
    ["progress-bodyweight"],
    ["load-bodyweight"],
    ...(userId
      ? [["progress-bw", userId], ["combined-bodyweight", userId], ["latest-bodyweight-kg", userId]]
      : []),
  ];
}
