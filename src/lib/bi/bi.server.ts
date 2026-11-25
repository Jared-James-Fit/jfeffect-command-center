/**
 * Business intelligence's reads (Nov 25 2026): one database read per Analytics tab (bi_* functions,
 * service role only), shaped by model.ts. Server only, and only ever called after an admin check
 * (bi.functions.ts, and Cleo's business_analytics lookup).
 *
 * A read is kept for CACHE_MS on this server instance, keyed by tab and range, so switching tabs and
 * coming back (or Cleo asking right after the page loaded) never runs the same query twice.
 */
import { buildInsights, weeklySummary, type BiInsight, type WeeklySummary } from "./insights";
import {
  shapeAcquisition,
  shapeConversions,
  shapeEngagement,
  shapeGeography,
  shapeKpis,
  shapeOverview,
  shapeRetention,
  shapeRevenue,
  shapeTechnical,
  visitsCover,
  type AcquisitionView,
  type BiTab,
  type ConversionsView,
  type EngagementView,
  type GeographyView,
  type OverviewView,
  type RetentionView,
  type RevenueView,
  type TechnicalView,
} from "./model";
import { businessDay, lastFullWeek, type BiRange } from "./period";

export const CACHE_MS = 2 * 60_000;

export type InsightsView = { insights: BiInsight[]; weekly: WeeklySummary | null; generatedFrom: BiTab[] };

export type BiTabData = {
  overview: OverviewView;
  acquisition: AcquisitionView;
  geography: GeographyView;
  conversions: ConversionsView;
  engagement: EngagementView;
  retention: RetentionView;
  revenue: RevenueView;
  technical: TechnicalView;
  insights: InsightsView;
};

const cache = new Map<string, { at: number; value: unknown }>();

async function rpc(db: any, fn: string, range: BiRange): Promise<unknown> {
  const key = `${fn}|${range.from}|${range.to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const { data, error } = await db.rpc(fn, { _from: range.from, _to: range.to });
  if (error) throw new Error(error.message);
  cache.set(key, { at: Date.now(), value: data });
  if (cache.size > 200) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
  return data;
}

export function clearBiCache(): void {
  cache.clear();
}

export async function loadBiTab<T extends BiTab>(db: any, tab: T, range: BiRange, opts: { fresh?: boolean; today?: string } = {}): Promise<BiTabData[T]> {
  if (opts.fresh) for (const k of [...cache.keys()]) if (k.endsWith(`|${range.from}|${range.to}`)) cache.delete(k);
  const today = opts.today ?? businessDay();
  switch (tab) {
    case "overview":
      return shapeOverview(await rpc(db, "bi_overview", range)) as BiTabData[T];
    case "acquisition":
      return shapeAcquisition(await rpc(db, "bi_acquisition", range)) as BiTabData[T];
    case "geography":
      return shapeGeography(await rpc(db, "bi_geography", range)) as BiTabData[T];
    case "conversions":
      return shapeConversions(await rpc(db, "bi_conversions", range)) as BiTabData[T];
    case "engagement":
      return shapeEngagement(await rpc(db, "bi_engagement", range)) as BiTabData[T];
    case "retention":
      return shapeRetention(await rpc(db, "bi_retention", range), today) as BiTabData[T];
    case "revenue": {
      const [rev, ret] = await Promise.all([rpc(db, "bi_revenue", range), rpc(db, "bi_retention", range)]);
      return shapeRevenue(rev, shapeRetention(ret, today).clientsByMonth, today) as BiTabData[T];
    }
    case "technical":
      return shapeTechnical(await rpc(db, "bi_technical", range)) as BiTabData[T];
    case "insights":
      return (await loadInsights(db, range, today)) as BiTabData[T];
  }
  throw new Error(`Unknown tab ${String(tab)}`);
}

/** Every tab's read (in parallel), the insights from them, and last week's summary. */
export async function loadInsights(db: any, range: BiRange, today = businessDay()): Promise<InsightsView> {
  const tabs = ["overview", "acquisition", "geography", "conversions", "engagement", "retention", "revenue", "technical"] as const;
  const settled = await Promise.allSettled(tabs.map((t) => loadBiTab(db, t, range, { today })));
  const got: Partial<Record<(typeof tabs)[number], any>> = {};
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") got[tabs[i]] = s.value;
  });
  const insights = buildInsights({ today, ...got });
  let weekly: WeeklySummary | null = null;
  try {
    const { week, before } = lastFullWeek(today);
    const [cur, prev] = await Promise.all([kpis(db, week), kpis(db, before)]);
    weekly = weeklySummary(week, cur, prev, got.overview?.mrr?.mrrCents ?? null, visitsCover(before.from, got.overview?.visitsSince ?? null));
  } catch {
    weekly = null;
  }
  return { insights, weekly, generatedFrom: tabs.filter((t) => got[t]) };
}

async function kpis(db: any, r: BiRange) {
  const key = `bi_kpis|${r.from}|${r.to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return shapeKpis(hit.value);
  const { data, error } = await db.rpc("bi_kpis", { _from: r.from, _to: r.to });
  if (error) throw new Error(error.message);
  cache.set(key, { at: Date.now(), value: data });
  return shapeKpis(data);
}

const CLEO_SECTIONS = ["overview", "acquisition", "geography", "conversions", "engagement", "retention", "revenue", "technical", "insights"] as const;

/**
 * Cleo's business_analytics lookup: the admin check runs through the caller's own login (so its
 * two-step counts), and only then are the reads made as the server. A section that can't be read is
 * left out, and the text says only what it has.
 */
export async function analyticsForCleo(
  callerDb: any,
  caller: string,
  section: string,
  from: string | undefined,
  to: string | undefined,
  today: string,
): Promise<string> {
  const { data: isAdmin } = await callerDb.rpc("has_role", { _user_id: caller, _role: "admin" });
  if (!isAdmin) return "Only an admin can read the business analytics.";
  const { checkedRange } = await import("./period");
  const { analyticsText } = await import("./cleo-text");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const range = checkedRange(from, to, today);
  const tabs: readonly BiTab[] =
    section === "all" || section === "insights" ? CLEO_SECTIONS : (CLEO_SECTIONS as readonly string[]).includes(section) ? [section as BiTab] : ["overview"];
  const data: Record<string, unknown> = {};
  await Promise.all(
    tabs.map(async (t) => {
      try {
        data[t] = await loadBiTab(supabaseAdmin, t, range, { today });
      } catch {
        /* left out */
      }
    }),
  );
  return analyticsText(section as any, range, data as any);
}
