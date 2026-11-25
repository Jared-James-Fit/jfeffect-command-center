/**
 * Analytics (/admin/insights, Nov 25 2026): the business at a glance and in depth, one tab per
 * question. Overview · Acquisition · Audience & Geography · Conversions · App Engagement · Retention
 * · Revenue · Technical Performance · Cleo Insights. The tab and the period live in the address, so
 * a link opens the same view. Each tab loads its own read (bi.functions.ts) only when it's opened,
 * and keeps it for a few minutes; Export downloads what the tab shows as CSV.
 */
import { Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { getLiveNowFn } from "@/lib/admin-intel/app-intel.functions";
import { getBiTabFn } from "@/lib/bi/bi.functions";
import { BI_TAB_LABEL, BI_TABS, type BiTab } from "@/lib/bi/model";
import { businessDay, PERIOD_PRESETS, previousRange, rangeFor, rangeLabel, type BiRange, type PresetKey } from "@/lib/bi/period";
import { tablesFor, toCsv } from "@/lib/bi/csv";

const TABS: Record<BiTab, ComponentType<TabProps>> = {
  overview: lazyWithRetry(() => import("./overview-tab").then((m) => ({ default: m.OverviewTab }))),
  acquisition: lazyWithRetry(() => import("./acquisition-tab").then((m) => ({ default: m.AcquisitionTab }))),
  geography: lazyWithRetry(() => import("./geography-tab").then((m) => ({ default: m.GeographyTab }))),
  conversions: lazyWithRetry(() => import("./conversions-tab").then((m) => ({ default: m.ConversionsTab }))),
  engagement: lazyWithRetry(() => import("./engagement-tab").then((m) => ({ default: m.EngagementTab }))),
  retention: lazyWithRetry(() => import("./retention-tab").then((m) => ({ default: m.RetentionTab }))),
  revenue: lazyWithRetry(() => import("./revenue-tab").then((m) => ({ default: m.RevenueTab }))),
  technical: lazyWithRetry(() => import("./technical-tab").then((m) => ({ default: m.TechnicalTab }))),
  insights: lazyWithRetry(() => import("./insights-tab").then((m) => ({ default: m.InsightsTab }))),
};

export type TabProps = { range: BiRange; today: string; goTo: (tab: BiTab) => void };

export type AnalyticsSearch = { tab?: BiTab; p?: PresetKey; from?: string; to?: string };

/** One tab's read, cached by tab and range (and shared with whoever else asks for it). */
export function useBiTab<T = any>(tab: BiTab, range: BiRange, enabled = true) {
  const fetchTab = useServerFn(getBiTabFn);
  return useQuery({
    queryKey: ["admin-bi", tab, range.from, range.to],
    queryFn: async () => (await fetchTab({ data: { tab, from: range.from, to: range.to } })).data as T,
    enabled,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });
}

export function AnalyticsPage({ search, onSearch }: { search: AnalyticsSearch; onSearch: (s: AnalyticsSearch) => void }) {
  const today = useMemo(() => businessDay(), []);
  const tab: BiTab = search.tab && (BI_TABS as readonly string[]).includes(search.tab) ? search.tab : "overview";
  const preset: PresetKey = search.p ?? "30d";
  const range = useMemo(() => rangeFor(preset, today, { from: search.from, to: search.to }), [preset, today, search.from, search.to]);
  const before = previousRange(range);
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);
  useEffect(() => {
    setCustomFrom(range.from);
    setCustomTo(range.to);
  }, [range.from, range.to]);
  const q = useBiTab(tab, range);
  const goTo = (t: BiTab) => {
    onSearch({ ...search, tab: t });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const TabBody = TABS[tab];
  const fetchTab = useServerFn(getBiTabFn);

  const exportCsv = async () => {
    try {
      const data = q.data ?? (await fetchTab({ data: { tab, from: range.from, to: range.to } })).data;
      const tables = tablesFor(tab, tab === "insights" ? { insights: (data as any)?.insights ?? [] } : ({ [tab]: data } as any));
      if (!tables.length) {
        toast("Nothing to export yet");
        return;
      }
      const csv = toCsv(tables);
      const name = `jf-effect-${tab}-${range.from}-to-${range.to}.csv`;
      const file = new File([csv], name, { type: "text/csv" });
      const { saveFiles } = await import("@/lib/file-share");
      await saveFiles([file]);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't make the file");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 pb-28 pt-2 md:px-6" data-analytics-page={tab}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LivePill />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
            aria-label="Refresh"
          >
            {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void exportCsv()} data-analytics-export>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg border bg-card p-0.5">
          {[...PERIOD_PRESETS.map((p) => ({ key: p.key as PresetKey, label: p.label })), { key: "custom" as PresetKey, label: "Custom" }].map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={preset === p.key}
              onClick={() => onSearch(p.key === "custom" ? { ...search, p: "custom", from: range.from, to: range.to } : { tab: search.tab, p: p.key })}
              className={cn(
                "min-h-9 rounded-md px-2.5 text-[13px] font-medium transition-colors sm:px-3",
                preset === p.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSearch({ ...search, p: "custom", from: customFrom, to: customTo });
            }}
          >
            <label className="sr-only" htmlFor="bi-from">From</label>
            <input id="bi-from" type="date" value={customFrom} max={today} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 rounded-lg border bg-background px-2 text-[13px]" />
            <span className="text-[13px] text-muted-foreground">to</span>
            <label className="sr-only" htmlFor="bi-to">To</label>
            <input id="bi-to" type="date" value={customTo} max={today} onChange={(e) => setCustomTo(e.target.value)} className="h-9 rounded-lg border bg-background px-2 text-[13px]" />
            <Button type="submit" size="sm" variant="outline" className="h-9">Apply</Button>
          </form>
        )}
        <span className="text-[12px] text-muted-foreground">
          {rangeLabel(range)} · compared with {rangeLabel(before)}
        </span>
      </div>

      <nav aria-label="Analytics sections" className="-mx-4 overflow-x-auto border-b px-4 md:mx-0 md:px-0">
        <div className="flex min-w-max gap-1">
          {BI_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => goTo(t)}
              aria-current={t === tab ? "page" : undefined}
              className={cn(
                "relative min-h-10 whitespace-nowrap px-3 text-[14px] font-medium transition-colors",
                t === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              data-analytics-tab={t}
            >
              {BI_TAB_LABEL[t]}
              {t === tab && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-foreground" aria-hidden />}
            </button>
          ))}
        </div>
      </nav>

      {q.isError && !q.data ? (
        <div className="rounded-2xl border p-6 text-center text-[13px] text-muted-foreground">
          <p>Couldn't load {BI_TAB_LABEL[tab]}. {(q.error as any)?.message ? String((q.error as any).message).slice(0, 160) : ""}</p>
          <Button variant="outline" size="sm" className="mt-3 h-9" onClick={() => void q.refetch()}>Try again</Button>
        </div>
      ) : (
        <Suspense fallback={<TabSkeleton />}>
          {q.data ? <TabBody range={range} today={today} goTo={goTo} /> : <TabSkeleton />}
        </Suspense>
      )}
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  );
}

function LivePill() {
  const fetchLive = useServerFn(getLiveNowFn);
  const q = useQuery({ queryKey: ["admin-live-now"], queryFn: () => fetchLive(), refetchInterval: 30_000 });
  const n = q.data?.total ?? 0;
  const where = q.data?.byFeature?.slice(0, 3).map((f: any) => `${f.feature} ${f.n}`).join(" · ");
  return (
    <div className="flex items-center gap-2 text-[13px]" aria-live="polite">
      <span className={cn("relative flex h-2.5 w-2.5", n > 0 ? "" : "opacity-40")} aria-hidden>
        {n > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--viz-3)] opacity-60 motion-reduce:animate-none" />}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--viz-3)]" />
      </span>
      <span className="font-semibold tabular-nums">{n}</span>
      <span className="text-muted-foreground">in the app now{where ? ` · ${where}` : ""}</span>
    </div>
  );
}
