import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dumbbell, History, CalendarDays, CalendarRange, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

type Unit = "lb" | "kg";
const LB_PER_KG = 2.2046226;

function toLb(value: number, unit: "lb" | "kg" | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return unit === "kg" ? value * LB_PER_KG : value;
}

function convFromLb(lb: number, to: Unit): number {
  return to === "kg" ? lb / LB_PER_KG : lb;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatBig(n: number, unit: Unit): string {
  if (!Number.isFinite(n) || n <= 0) return `0 ${unit}`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M ${unit}`;
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString()}k ${unit}`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k ${unit}`;
  return `${Math.round(n).toLocaleString()} ${unit}`;
}

type Summary = {
  lifetime_lb: number;
  last_lb: number;
  last_date: Date | null;
  week_lb: number;
  month_lb: number;
  block_lb: number;
  block_name: string | null;
  sessions: number;
  fallbackSessions: number;
};

/**
 * Lifetime / Last / This week / This month / Current block weight totals.
 *
 * Source: pl_row_results (normalized_lb * actual_reps), aggregated per
 * calendar day. When a day has a pl_day_completions row but no logged
 * sets, we fall back to the quick-popup `session_weight_total` for that
 * session. Always reads via supabase client so RLS scopes to the caller.
 */
export function WeightLiftedCard({ clientId, displayUnit }: { clientId: string; displayUnit: Unit }) {
  const { data, isLoading } = useQuery({
    queryKey: ["weight-lifted", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const [setsRes, daysRes, prepRes] = await Promise.all([
        supabase
          .from("pl_row_results")
          .select("normalized_lb, actual_load, actual_load_unit, actual_reps, completed_at")
          .eq("client_id", clientId)
          .not("actual_reps", "is", null)
          .not("completed_at", "is", null),
        (supabase.from("pl_day_completions") as any)
          .select("completed_at, session_weight_total, session_weight_unit")
          .eq("client_id", clientId)
          .not("completed_at", "is", null)
          .not("session_weight_total", "is", null),
        (supabase.from("pl_preps") as any)
          .select("start_date, end_date, name, title, status")
          .eq("client_id", clientId)
          .in("status", ["Active", "Planned"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        sets: (setsRes.data ?? []) as any[],
        days: (daysRes.data ?? []) as any[],
        prep: (prepRes.data ?? null) as any,
      };
    },
  });

  const summary = useMemo<Summary | null>(() => {
    if (!data) return null;
    const { sets, days, prep } = data;

    // Sum sets per calendar day in LB.
    const setsByDay = new Map<string, number>();
    for (const s of sets) {
      const reps = Number(s.actual_reps ?? 0);
      if (!reps) continue;
      // Prefer normalized_lb; fall back to raw actual_load when missing.
      let lb = 0;
      if (s.normalized_lb != null) {
        lb = Number(s.normalized_lb) || 0;
      } else if (s.actual_load != null) {
        lb = toLb(Number(s.actual_load) || 0, (s.actual_load_unit as any) ?? "lb");
      }
      if (lb <= 0) continue;
      const key = dayKey(new Date(s.completed_at));
      setsByDay.set(key, (setsByDay.get(key) ?? 0) + lb * reps);
    }

    // Per-day totals, preferring logged sets; fall back to quick-popup session total.
    const perDay = new Map<string, { date: Date; weight_lb: number; fromFallback: boolean }>();
    for (const d of days) {
      const dt = new Date(d.completed_at);
      const key = dayKey(dt);
      const setTotal = setsByDay.get(key) ?? 0;
      if (setTotal > 0) {
        perDay.set(key, { date: dt, weight_lb: setTotal, fromFallback: false });
      } else {
        const t = Number(d.session_weight_total ?? 0);
        if (t > 0) {
          const lb = toLb(t, (d.session_weight_unit as any) ?? "lb");
          perDay.set(key, { date: dt, weight_lb: lb, fromFallback: true });
        }
      }
    }
    // Include days that have set logs but no completion row.
    for (const [key, total] of setsByDay) {
      if (perDay.has(key)) continue;
      perDay.set(key, { date: new Date(key + "T12:00:00Z"), weight_lb: total, fromFallback: false });
    }

    const all = [...perDay.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
    const lifetime = all.reduce((s, x) => s + x.weight_lb, 0);
    const last = all[0]?.weight_lb ?? 0;
    const lastDate = all[0]?.date ?? null;

    const now = Date.now();
    const weekCut = now - 7 * 86400000;
    const monthCut = now - 30 * 86400000;
    const week = all.filter((d) => d.date.getTime() >= weekCut).reduce((s, x) => s + x.weight_lb, 0);
    const month = all.filter((d) => d.date.getTime() >= monthCut).reduce((s, x) => s + x.weight_lb, 0);

    let block = 0;
    let blockName: string | null = null;
    if (prep?.start_date) {
      const start = new Date(prep.start_date).getTime();
      const end = prep.end_date ? new Date(prep.end_date + "T23:59:59").getTime() : now;
      block = all
        .filter((d) => d.date.getTime() >= start && d.date.getTime() <= end)
        .reduce((s, x) => s + x.weight_lb, 0);
      blockName = prep.name ?? prep.title ?? null;
    }

    const fallbackSessions = all.filter((d) => d.fromFallback).length;

    return {
      lifetime_lb: lifetime,
      last_lb: last,
      last_date: lastDate,
      week_lb: week,
      month_lb: month,
      block_lb: block,
      block_name: blockName,
      sessions: all.length,
      fallbackSessions,
    };
  }, [data]);

  if (isLoading) {
    return (
      <section aria-label="Weight Lifted">
        <div className="mb-3 flex items-center gap-2">
          <Dumbbell className="h-5 w-5 text-primary" />
          <h2 className="text-base font-black uppercase tracking-wider">Weight Lifted</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="p-4"><Skeleton className="h-14 w-full" /></Card>
          ))}
        </div>
      </section>
    );
  }

  if (!summary || summary.lifetime_lb <= 0) {
    return null; // nothing to show yet — keep the page clean for new clients.
  }

  const conv = (lb: number) => convFromLb(lb, displayUnit);
  const tiles: { icon: typeof Dumbbell; label: string; value: string; sublabel?: string | null }[] = [
    {
      icon: Dumbbell,
      label: "Lifetime",
      value: formatBig(conv(summary.lifetime_lb), displayUnit),
      sublabel: summary.sessions > 0 ? `${summary.sessions} session${summary.sessions === 1 ? "" : "s"}` : null,
    },
    {
      icon: History,
      label: "Last workout",
      value: formatBig(conv(summary.last_lb), displayUnit),
      sublabel: summary.last_date ? format(summary.last_date, "MMM d") : null,
    },
    {
      icon: CalendarDays,
      label: "This week",
      value: formatBig(conv(summary.week_lb), displayUnit),
      sublabel: "last 7 days",
    },
    {
      icon: CalendarRange,
      label: "This month",
      value: formatBig(conv(summary.month_lb), displayUnit),
      sublabel: "last 30 days",
    },
    {
      icon: Layers,
      label: "Current block",
      value: formatBig(conv(summary.block_lb), displayUnit),
      sublabel: summary.block_name ?? (summary.block_lb > 0 ? "active block" : "no active block"),
    },
  ];

  return (
    <section aria-label="Weight Lifted">
      <div className="mb-3 flex items-center gap-2">
        <Dumbbell className="h-5 w-5 text-primary" />
        <h2 className="text-base font-black uppercase tracking-wider">Weight Lifted</h2>
        {summary.fallbackSessions > 0 && (
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {summary.fallbackSessions} quick-log session{summary.fallbackSessions === 1 ? "" : "s"} included
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Card key={t.label} className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon className="h-4 w-4 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-widest">{t.label}</span>
              </div>
              <div className="mt-2 text-xl font-black tabular-nums leading-tight sm:text-2xl">
                {t.value}
              </div>
              {t.sublabel && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">{t.sublabel}</div>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}