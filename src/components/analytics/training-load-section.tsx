/**
 * Volume & workload on the analytics page, the same for the coach and the
 * athlete (the coach sees the programming detail on top: relative intensity,
 * effort spread, how concentrated a muscle's week is, coach-only flags). Every
 * number is training-load.ts; nothing here works anything out.
 */
import { useMemo, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/analytics/info-tip";
import {
  LIFT_LABEL, TRAINING_LOAD_DEFINITIONS,
  type Insight, type LiftLoad, type TrainingLoad, type WeekLoad,
} from "@/lib/analytics/training-load";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/today";
import type { BlockVolumeRow } from "@/lib/analytics/analytics-areas";
import { BlockVolumeList } from "@/components/analytics/analytics-area-cards";

const SERIES = "var(--chart-4)";
const SERIES_SOFT = "color-mix(in oklch, var(--chart-4) 38%, transparent)";
const heat = (share: number) => `color-mix(in oklch, var(--chart-4) ${Math.round(12 + share * 70)}%, transparent)`;

type View = "muscles" | "patterns" | "lifts" | "days" | "blocks";

export function TrainingLoadSection({
  load,
  coach,
  unit,
  rangeLabel,
  planLoading,
  planError,
  header,
  hideInsights = false,
  hideMuscles = false,
  blockRows,
}: {
  load: TrainingLoad;
  /** the coach's view: programming detail and coach-only flags */
  coach: boolean;
  unit: "kg" | "lb";
  rangeLabel: string;
  planLoading?: boolean;
  planError?: boolean;
  header?: React.ReactNode;
  /** the insights are shown elsewhere on the page (the analytics Overview) */
  hideInsights?: boolean;
  /** each block's weekly sets (By block); left out with under two */
  blockRows?: BlockVolumeRow[];
  /** the muscles are shown elsewhere on the page (the muscle map) */
  hideMuscles?: boolean;
}) {
  const insights = hideInsights ? [] : load.insights.filter((i) => coach || i.audience === "both");
  const hasLifts = load.lifts.length > 0;
  const hasDays = !!load.distribution;
  const views: Array<[View, string]> = [
    ...(hideMuscles ? [] : ([["muscles", "Muscles"]] as Array<[View, string]>)),
    ["patterns", "Movements"],
    ...(hasLifts ? ([["lifts", "Lifts"]] as Array<[View, string]>) : []),
    ...(hasDays ? ([["days", "By session"]] as Array<[View, string]>) : []),
    ...((blockRows?.length ?? 0) >= 2 ? ([["blocks", "By block"]] as Array<[View, string]>) : []),
  ];
  const [view, setView] = useState<View>(hideMuscles ? "patterns" : "muscles");
  const shown = views.some(([v]) => v === view) ? view : views[0][0];

  if (!load.totals.sets && !load.weeks.some((w) => (w.prescribed ?? 0) > 0)) {
    return (
      <section aria-label="Volume and workload">
        {header}
        <Card className="p-6 text-sm text-muted-foreground">No working sets logged in {rangeLabel.toLowerCase()} yet.</Card>
      </section>
    );
  }
  const t = load.totals;
  return (
    <section aria-label="Volume and workload" className="space-y-3" data-training-load>
      {header}
      {insights.length > 0 && <InsightList insights={insights} coach={coach} />}

      <Card className="space-y-4 p-4">
        {/* the period in two numbers, each said against what it's out of */}
        <div className="grid grid-cols-2 gap-3">
          <Stat
            label={load.perWeekBasis.partial ? "Working sets this week" : "Working sets a week"}
            value={String(t.setsPerWeek)}
            sub={load.perWeekBasis.partial ? "No full week yet" : `Average of ${load.perWeekBasis.weeks} full week${load.perWeekBasis.weeks === 1 ? "" : "s"}`}
          />
          <Stat
            label="Hard sets (RPE 7+)"
            value={t.sets - t.unratedSets > 0 ? `${Math.round((t.hardSets / (t.sets - t.unratedSets)) * 100)}%` : "—"}
            sub={
              t.sets - t.unratedSets > 0
                ? `of ${(t.sets - t.unratedSets).toLocaleString()} rated sets${t.unratedSets ? ` · ${t.unratedSets} unrated` : ""}`
                : "No sets rated yet"
            }
          />
        </div>

        <WeeklyChart weeks={load.weeks} unit={unit} />
      </Card>

      <Card className="p-4">
        <div role="tablist" aria-label="Volume by" className="-mx-1 mb-3 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {views.map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={shown === v}
              onClick={() => setView(v)}
              className={cn(
                "h-9 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors",
                shown === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              data-load-view={v}
            >
              {label}
            </button>
          ))}
        </div>
        {shown === "muscles" && <Muscles load={load} coach={coach} />}
        {shown === "patterns" && <Patterns load={load} />}
        {shown === "lifts" && <Lifts lifts={load.lifts} coach={coach} unit={unit} />}
        {shown === "days" && load.distribution && <Days dist={load.distribution} />}
        {shown === "blocks" && blockRows && <BlockVolumeList rows={blockRows} />}
      </Card>

      <Definitions />
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── insights ─────────────────────────────────────────────────────────────

const TONE_DOT: Record<Insight["tone"], string> = {
  watch: "bg-amber-500",
  info: "bg-muted-foreground/60",
  good: "bg-emerald-500",
};

/** The insights, each opening its why, what to do and how sure it is (also the analytics Overview's list). */
export function InsightList({ insights, coach, onSeeNumbers, titled = true }: { insights: Insight[]; coach: boolean; onSeeNumbers?: () => void; titled?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card className="divide-y divide-border/60 p-0" data-load-insights>
      {titled && (
        <div className="flex items-center gap-2 px-4 pb-2 pt-3">
          <h3 className="text-sm font-semibold">{coach ? "Coaching insights" : "What stands out"}</h3>
          <span className="text-xs text-muted-foreground">from the numbers below</span>
        </div>
      )}
      {insights.map((i) => {
        const isOpen = open === i.id;
        return (
          <div key={i.id} data-insight={i.id}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i.id)}
              aria-expanded={isOpen}
              className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40"
            >
              <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE_DOT[i.tone])} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{i.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{i.observation}</span>
              </span>
              <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
              <div className="space-y-2 px-4 pb-3 pl-9 text-xs">
                <p><span className="font-semibold">Why it might be: </span><span className="text-muted-foreground">{i.explanation}</span></p>
                <p><span className="font-semibold">{i.actionNeeded ? "What to do: " : "If anything: "}</span><span className="text-muted-foreground">{i.action}</span></p>
                {i.evidence.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                    {i.evidence.map((e) => <li key={e}>{e}</li>)}
                  </ul>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    {i.confidence === "high" ? "High" : i.confidence === "medium" ? "Medium" : "Low"} confidence
                    {i.actionNeeded ? "" : " · no change required"}
                  </span>
                  {onSeeNumbers && (
                    <button type="button" onClick={onSeeNumbers} className="inline-flex min-h-9 items-center font-semibold text-foreground hover:underline">
                      See the numbers
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

// ── the weeks ────────────────────────────────────────────────────────────

/** A long period (6 months, a year) reads by month: 52 weekly bars don't fit a phone. */
function byMonth(weeks: WeekLoad[]): WeekLoad[] {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const out = new Map<string, WeekLoad>();
  for (const w of weeks) {
    // a week belongs to the month its Thursday falls in
    const thu = new Date(Date.parse(`${w.key}T00:00:00Z`) + 3 * 86_400_000);
    const key = `${thu.getUTCFullYear()}-${String(thu.getUTCMonth() + 1).padStart(2, "0")}`;
    const cur = out.get(key);
    if (!cur) {
      out.set(key, { ...w, key, label: `${M[thu.getUTCMonth()]} ${thu.getUTCFullYear()}`, phase: null, muscles: {}, patterns: {} });
      continue;
    }
    cur.sets += w.sets;
    cur.hardSets += w.hardSets;
    cur.unratedSets += w.unratedSets;
    cur.reps += w.reps;
    cur.tonnageKg += w.tonnageKg;
    cur.sessions += w.sessions;
    cur.current = cur.current || w.current;
    cur.future = cur.future && w.future;
    if (w.prescribed != null) {
      cur.prescribed = (cur.prescribed ?? 0) + w.prescribed;
      cur.completedOfPrescribed = (cur.completedOfPrescribed ?? 0) + (w.completedOfPrescribed ?? 0);
      cur.missed = (cur.missed ?? 0) + (w.missed ?? 0);
      cur.extra = (cur.extra ?? 0) + (w.extra ?? 0);
    }
  }
  return [...out.values()];
}

export function WeeklyChart({ weeks, unit }: { weeks: WeekLoad[]; unit: "kg" | "lb" }) {
  const monthly = weeks.length > 20;
  const shown = monthly ? byMonth(weeks) : weeks;
  const [picked, setPicked] = useState<string | null>(null);
  const max = Math.max(1, ...shown.map((w) => Math.max(w.sets, w.prescribed ?? 0)));
  const sel = shown.find((w) => w.key === picked) ?? [...shown].reverse().find((w) => w.sets > 0) ?? shown[shown.length - 1];
  const hasPlan = shown.some((w) => w.prescribed != null);
  if (!shown.length) return null;
  const toUnit = (kg: number) => Math.round(unit === "lb" ? kg * 2.2046226 : kg);
  return (
    <div data-load-weeks>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Working sets by {monthly ? "month" : "week"}</span>
        <Legend swatch={<span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES }} />} label="Hard (RPE 7+)" />
        <Legend swatch={<span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_SOFT }} />} label="Other working" />
        {hasPlan && <Legend swatch={<span className="h-0 w-3 border-t-2 border-dashed border-foreground/60" />} label="Written" />}
      </div>
      <div className="mt-3 flex h-28 items-end gap-[3px]" role="img" aria-label="Working sets each week">
        {shown.map((w) => {
          const hardH = (w.hardSets / max) * 100;
          const otherH = ((w.sets - w.hardSets) / max) * 100;
          const planH = w.prescribed != null ? (w.prescribed / max) * 100 : null;
          const active = sel?.key === w.key;
          return (
            <button
              key={w.key}
              type="button"
              onClick={() => setPicked(w.key)}
              onMouseEnter={() => setPicked(w.key)}
              className={cn("group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm", active && "bg-muted/60")}
              aria-label={`${w.label}: ${w.sets} working sets${w.prescribed != null ? ` of ${w.prescribed} written` : ""}`}
              data-week={w.key}
            >
              {planH != null && (
                <span aria-hidden className="absolute inset-x-0 border-t-2 border-dashed border-foreground/60" style={{ bottom: `${planH}%` }} />
              )}
              {otherH > 0 && <span aria-hidden className="mx-[2px] block rounded-t-[3px]" style={{ height: `${otherH}%`, background: SERIES_SOFT, marginBottom: hardH > 0 ? 2 : 0 }} />}
              {hardH > 0 && <span aria-hidden className={cn("mx-[2px] block", otherH > 0 ? "" : "rounded-t-[3px]")} style={{ height: `${hardH}%`, background: SERIES }} />}
              {w.current && <span aria-hidden className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-foreground" />}
            </button>
          );
        })}
      </div>
      {sel && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs" data-load-week-detail>
          <span className="font-semibold">{sel.label}{sel.current ? (monthly ? " · this month" : " · this week") : ""}{sel.phase ? ` · ${sel.phase}` : ""}</span>
          <span className="tabular-nums text-muted-foreground">
            {sel.sets} sets · {sel.hardSets} hard{sel.unratedSets ? ` · ${sel.unratedSets} unrated` : ""}
            {sel.prescribed != null ? ` · ${sel.completedOfPrescribed} of ${sel.prescribed} written done${sel.missed ? `, ${sel.missed} missed` : ""}${sel.extra ? `, ${sel.extra} extra` : ""}` : ""}
            {sel.sessions ? ` · ${sel.sessions} session${sel.sessions === 1 ? "" : "s"}` : ""}
            {sel.tonnageKg ? ` · ${toUnit(sel.tonnageKg).toLocaleString()} ${unit} moved` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return <span className="inline-flex items-center gap-1.5">{swatch}{label}</span>;
}

// ── muscles and patterns ─────────────────────────────────────────────────

export function Muscles({ load, coach }: { load: TrainingLoad; coach: boolean }) {
  const rows = load.muscles.filter((m) => m.perWeek > 0);
  const max = Math.max(1, ...rows.map((m) => m.perWeek));
  if (!rows.length) return <p className="text-sm text-muted-foreground">No sets credited to a muscle in this range.</p>;
  return (
    <div aria-label="Volume by Muscle Group" data-load-muscles>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{load.perWeekBasis.partial ? "Sets this week so far" : "Sets a week"}</span>
        <Legend swatch={<span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES }} />} label="Aimed at it" />
        <Legend swatch={<span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_SOFT }} />} label="Helping (½ set)" />
      </div>
      <ul className="space-y-2.5">
        {rows.map((m) => {
          // each figure says what it is: sets a week, how many days a week it's trained,
          // and a change only with the weeks it's measured against
          const meta = [
            m.directPerWeek > 0 ? `${m.frequency} day${m.frequency === 1 ? "" : "s"} a week` : "helping only",
            coach && m.topSessionShare != null && m.topSessionShare >= 0.7 ? `${Math.round(m.topSessionShare * 100)}% in one session` : null,
          ].filter(Boolean).join(" · ");
          const change = m.changePct != null && Math.abs(m.changePct) >= 15
            ? `${m.changePct > 0 ? "up" : "down"} ${Math.abs(m.changePct)}% (last 2 weeks vs the 2 before)`
            : null;
          return (
            <li key={m.muscle} className="text-sm" data-muscle={m.muscle} title={`${m.muscle}: ${m.perWeek} sets a week (${m.directPerWeek} aimed at it)`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{m.muscle}</span>
                <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  <span className="font-semibold text-foreground">{m.perWeek}</span> sets
                </span>
              </div>
              {/* one scale for every row: the bar always spans the same track */}
              <div className="mt-1 flex h-2 gap-[2px]">
                {m.directPerWeek > 0 && <span className="h-full rounded-l-[3px]" style={{ width: `${(m.directPerWeek / max) * 100}%`, background: SERIES }} />}
                {m.perWeek - m.directPerWeek > 0.01 && (
                  <span className={cn("h-full", m.directPerWeek > 0 ? "rounded-r-[3px]" : "rounded-[3px]")} style={{ width: `${((m.perWeek - m.directPerWeek) / max) * 100}%`, background: SERIES_SOFT }} />
                )}
              </div>
              <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {meta}
                {change ? ` · ${change}` : ""}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Patterns({ load }: { load: TrainingLoad }) {
  const rows = load.patterns;
  const max = Math.max(1, ...rows.map((p) => p.perWeek));
  if (!rows.length) return <p className="text-sm text-muted-foreground">No working sets in this range.</p>;
  return (
    <div data-load-patterns>
      <p className="mb-2 text-xs text-muted-foreground">{load.perWeekBasis.partial ? "Working sets this week so far, by movement" : "Working sets a week by movement"}</p>
      <ul className="space-y-2.5">
        {rows.map((p) => (
          <li key={p.pattern} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate">{p.pattern}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">{p.perWeek}</span>
                {" sets"}
                {p.changePct != null && Math.abs(p.changePct) >= 15 ? ` · ${p.changePct > 0 ? "up" : "down"} ${Math.abs(p.changePct)}% vs 2 weeks before` : ""}
              </span>
            </div>
            <div className="mt-1 h-2"><span className="block h-full rounded-[3px]" style={{ width: `${(p.perWeek / max) * 100}%`, background: SERIES }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── the competition lifts ────────────────────────────────────────────────

const BANDS: Array<[keyof LiftLoad["intensity"], string, number]> = [
  ["lt70", "Under 70%", 0.15],
  ["b70", "70–79%", 0.4],
  ["b80", "80–89%", 0.65],
  ["ge90", "90%+", 0.95],
];

function Lifts({ lifts, coach, unit }: { lifts: LiftLoad[]; coach: boolean; unit: "kg" | "lb" }) {
  const toUnit = (kg: number) => Math.round(unit === "lb" ? kg * 2.2046226 : kg);
  return (
    <div className="space-y-4" data-load-lifts>
      {lifts.map((l) => {
        const known = l.intensity.lt70 + l.intensity.b70 + l.intensity.b80 + l.intensity.ge90;
        const since = l.trend.kind !== "unclear" ? (() => { const d = parseLocalDate(l.trend.firstDate); return d ? ` since ${format(d, "MMM d")}` : ""; })() : "";
        const trend = l.trend.kind === "unclear" ? "too early to call" : l.trend.kind === "steady" ? `about the same${since}` : `${l.trend.kind === "up" ? "up" : "down"} ${Math.abs(l.trend.pct)}%${since}`;
        return (
          <div key={l.lift} className="space-y-2" data-lift={l.lift}>
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold">{LIFT_LABEL[l.lift]}</h4>
              <span className="text-xs text-muted-foreground">Est. max {trend}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-5">
              <Mini label="Days a week" value={String(l.sessionsPerWeek)} />
              <Mini label="Sets a week" value={String(l.setsPerWeek)} />
              <Mini label="Heavy sessions" value={`${l.heavyExposures} of ${l.sessions}`} />
              <Mini label="Comp / var. sets" value={`${l.competitionSets} / ${l.variationSets}`} />
              <Mini label="Avg RPE" value={l.avgRpe != null ? String(l.avgRpe) : "—"} />
            </div>
            {coach && known > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  Intensity of loaded sets
                  <InfoTip label="About intensity" title="Intensity" align="start">
                    Each set's load as a % of the best estimated max {LIFT_LABEL[l.lift].toLowerCase()} showed in this range
                    {l.bestE1rmKg ? ` (${toUnit(l.bestE1rmKg)} ${unit})` : ""}, from sets rated RPE 7+ of 10 reps or fewer. Not a tested max or a training max.
                  </InfoTip>
                </div>
                <div className="flex h-3 gap-[2px] overflow-hidden rounded-[3px]" role="img" aria-label={BANDS.map(([k, label]) => `${label}: ${l.intensity[k]} sets`).join(", ")}>
                  {BANDS.map(([k, label, share]) => l.intensity[k] > 0 && (
                    <span key={k} title={`${label}: ${l.intensity[k]} sets`} style={{ width: `${(l.intensity[k] / known) * 100}%`, background: heat(share) }} />
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-muted-foreground">
                  {BANDS.filter(([k]) => l.intensity[k] > 0).map(([k, label, share]) => (
                    <span key={k} className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm" style={{ background: heat(share) }} />{label} {Math.round((l.intensity[k] / known) * 100)}%
                    </span>
                  ))}
                </div>
              </div>
            )}
            {coach && (
              <div className="text-[11px] tabular-nums text-muted-foreground">
                Reps: singles {l.reps.r1} · 2–3 {l.reps.r2_3} · 4–6 {l.reps.r4_6} · 7–10 {l.reps.r7_10}{l.reps.r11 ? ` · 11+ ${l.reps.r11}` : ""}
                {" · "}RPE: ≤6 {l.effort.le6} · 7s {l.effort.r7} · 8s {l.effort.r8} · 9+ {l.effort.ge9}{l.effort.unrated ? ` · unrated ${l.effort.unrated}` : ""}
                {l.volumeChangePct != null && Math.abs(l.volumeChangePct) >= 5 ? ` · volume ${l.volumeChangePct > 0 ? "+" : ""}${l.volumeChangePct}% later in range` : ""}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-1.5">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ── the week, day by day ─────────────────────────────────────────────────

function Days({ dist }: { dist: NonNullable<TrainingLoad["distribution"]> }) {
  const muscles = useMemo(() => {
    const tot = new Map<string, number>();
    for (const d of dist.days) for (const m of d.muscles) tot.set(m.muscle, (tot.get(m.muscle) ?? 0) + m.sets);
    return [...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([m]) => m);
  }, [dist]);
  const cellMax = Math.max(1, ...dist.days.flatMap((d) => d.muscles.filter((m) => muscles.includes(m.muscle)).map((m) => m.sets)));
  return (
    <div data-load-days>
      <p className="mb-2 text-xs text-muted-foreground">
        {dist.label}: where each session's work went. Darker cells = more sets credited that day; a filled lift = a heavy top set.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-[2px] text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-1 font-medium">Day</th>
              <th className="px-1 font-medium">Sets</th>
              <th className="px-1 font-medium">Lifts</th>
              {muscles.map((m) => <th key={m} className="px-1 text-center font-medium">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {dist.days.map((d) => (
              <tr key={d.day}>
                <td className="whitespace-nowrap px-1 py-1 font-medium">{d.label}</td>
                <td className="whitespace-nowrap px-1 tabular-nums">{d.sets}<span className="text-muted-foreground"> · {d.hardSets} hard</span></td>
                <td className="px-1">
                  <span className="flex flex-wrap gap-1">
                    {d.lifts.map((l) => (
                      <span key={l.lift} className={cn("whitespace-nowrap rounded px-1.5 py-0.5", l.heavy ? "bg-foreground text-background" : "bg-muted")} title={`${LIFT_LABEL[l.lift]}${l.heavy ? " (heavy)" : ""}: ${l.sets} sets${l.topRpe != null ? `, top RPE ${l.topRpe}` : ""}${l.topPct != null ? `, ${l.topPct}% of best estimated max` : ""}`}>
                        {LIFT_LABEL[l.lift]}
                      </span>
                    ))}
                  </span>
                </td>
                {muscles.map((m) => {
                  const v = d.muscles.find((x) => x.muscle === m)?.sets ?? 0;
                  return (
                    <td key={m} className="h-8 min-w-[2.75rem] rounded-[3px] text-center tabular-nums" style={{ background: v > 0 ? heat(v / cellMax) : undefined }} title={`${m} on ${d.label}: ${v} sets`}>
                      {v > 0 ? v : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Definitions() {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-1">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex min-h-10 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={open}>
        <Info className="h-3.5 w-3.5" /> How these are counted
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <dl className="mt-1 space-y-1.5 text-xs" data-load-definitions>
          {TRAINING_LOAD_DEFINITIONS.map(([k, v]) => (
            <div key={k}>
              <dt className="inline font-semibold">{k}: </dt>
              <dd className="inline text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
