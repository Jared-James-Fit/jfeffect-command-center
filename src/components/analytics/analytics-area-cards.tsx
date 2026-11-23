/**
 * The analytics page's area pieces (Overview's four cards, Strength's block
 * comparison and meet list, Volume's blocks, Consistency): every number from
 * analytics-areas.ts / training-load.ts, nothing worked out here.
 */
import { useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/today";
import { fmtNum } from "@/lib/analytics-format";
import {
  COMP_LIFTS,
  COMP_LIFT_LABEL,
  type CompLift,
  type MeetResult,
} from "@/lib/analytics/competition-strength";
import type {
  BlockStrengthRow,
  BlockVolumeRow,
  Consistency,
  AdherenceWeek,
  LiftsTrending,
} from "@/lib/analytics/analytics-areas";
import { LIFT_SERIES } from "@/components/analytics/competition-strength-chart";

const fmtDay = (iso: string, f = "MMM d") => {
  const d = parseLocalDate(iso);
  return d ? format(d, f) : iso;
};

// ── Overview ──────────────────────────────────────────────────────────────

/** One area on the Overview: its name, one answer, what it's measured against, a tap into the area. */
export function AreaCard({
  title,
  icon,
  value,
  unit,
  sub,
  onOpen,
  children,
  area,
}: {
  title: string;
  icon: ReactNode;
  value?: ReactNode;
  unit?: string;
  sub?: ReactNode;
  onOpen: () => void;
  children?: ReactNode;
  area: string;
}) {
  return (
    <Card className="p-0" data-area-card={area}>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full rounded-2xl p-4 text-left transition active:bg-muted/40"
        aria-label={`Open ${title}`}
      >
        <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <span className="shrink-0" aria-hidden>
            {icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </div>
        {value != null && (
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {value}
            </span>
            {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
          </div>
        )}
        {sub && <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{sub}</div>}
        {children}
      </button>
    </Card>
  );
}

/** Eight thin bars, the last one this week (lighter: it isn't over). */
export function MiniBars({
  values,
  currentLast = true,
  label,
}: {
  values: number[];
  currentLast?: boolean;
  label: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <span className="mt-3 flex h-8 items-end gap-1.5" role="img" aria-label={label}>
      {values.map((v, i) => (
        <span
          key={i}
          className={cn(
            "w-2 shrink-0 rounded-t-[2px]",
            v > 0
              ? currentLast && i === values.length - 1
                ? "bg-foreground/30"
                : "bg-foreground/65"
              : "bg-border",
          )}
          style={{ height: `${v > 0 ? Math.max(8, (v / max) * 100) : 6}%` }}
        />
      ))}
    </span>
  );
}

/** A plain progress bar for adherence: one neutral ink, never a status colour. */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span
      className="mt-2.5 block h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <span className="block h-full rounded-full bg-foreground/80" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** The three competition lifts in one row: each estimate now and its change in the period. */
export function LiftTriplet({
  rows,
}: {
  rows: Array<{
    lift: CompLift;
    value: number | null;
    change: string | null;
    tone: "up" | "down" | "flat" | "none";
  }>;
}) {
  return (
    <span className="mt-2 grid grid-cols-3 gap-2" data-overview-lifts>
      {rows.map((r) => (
        <span key={r.lift} className="min-w-0">
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: LIFT_SERIES[r.lift] }}
              aria-hidden
            />
            {COMP_LIFT_LABEL[r.lift]}
          </span>
          <span className="block text-xl font-semibold tabular-nums text-foreground">
            {r.value ?? "—"}
          </span>
          <span
            className={cn(
              "block truncate text-[12px] tabular-nums",
              r.tone === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {r.change ?? "No hard sets"}
          </span>
        </span>
      ))}
    </span>
  );
}

// ── Strength: blocks and meets ────────────────────────────────────────────

/**
 * Each block's best estimate per lift, oldest first, with the change from the
 * block before; filter to one phase to compare like with like (a peak against
 * a peak, never against a base block).
 */
export function BlockStrengthTable({
  rows,
  unit,
  conv,
}: {
  rows: BlockStrengthRow[];
  unit: string;
  conv: (lb: number) => number;
}) {
  const phases = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) if (r.phase) c.set(r.phase, (c.get(r.phase) ?? 0) + 1);
    return [...c.entries()].filter(([, n]) => n >= 2).map(([p]) => p);
  }, [rows]);
  const [phase, setPhase] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const lifts = COMP_LIFTS.filter((l) => rows.some((r) => r.best[l]));
  if (rows.length < 2 || !lifts.length) return null;
  const shownAll = phase ? rows.filter((r) => r.phase === phase) : rows;
  const shown = all ? shownAll : shownAll.slice(-6);
  // the change is against the previous block shown (within a phase, the previous block of that phase)
  const deltaOf = (r: BlockStrengthRow, l: CompLift): number | null => {
    const cur = r.best[l];
    if (!cur) return null;
    const before = shownAll
      .slice(0, shownAll.indexOf(r))
      .reverse()
      .find((x) => x.best[l]);
    return before ? Math.round(conv(cur.e1rm) - conv(before.best[l]!.e1rm)) : null;
  };
  return (
    <Card className="p-3 sm:p-4" data-block-strength>
      {phases.length > 0 && (
        <div
          className="-mx-1 mb-2 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
          role="group"
          aria-label="Phase"
        >
          {[null, ...phases].map((p) => (
            <button
              key={p ?? "all"}
              type="button"
              onClick={() => setPhase(p)}
              aria-pressed={phase === p}
              className={cn(
                "h-8 shrink-0 rounded-full border px-3 text-[12px] font-medium transition",
                phase === p
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground",
              )}
            >
              {p ?? "All blocks"}
            </button>
          ))}
        </div>
      )}
      <table className="w-full table-fixed text-[13px]">
        <colgroup>
          <col className="w-[40%]" />
          {lifts.map((l) => (
            <col key={l} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-[11px] text-muted-foreground">
            <th className="pb-1.5 text-left font-normal">Best est. max ({unit})</th>
            {lifts.map((l) => (
              <th key={l} className="pb-1.5 text-right font-normal">
                {COMP_LIFT_LABEL[l]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {shown.map((r) => (
            <tr key={r.id} className="align-top" data-block-row={r.id}>
              <td className="py-2 pr-2">
                <div className="truncate font-medium text-foreground">{r.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {fmtDay(r.start, "MMM d, yyyy")}
                </div>
              </td>
              {lifts.map((l) => {
                const b = r.best[l];
                const d = deltaOf(r, l);
                return (
                  <td key={l} className="py-2 text-right tabular-nums">
                    {b ? (
                      <>
                        <div className="text-foreground">{Math.round(conv(b.e1rm))}</div>
                        {d != null && d !== 0 && (
                          <div
                            className={cn(
                              "text-[11px]",
                              d > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground",
                            )}
                          >
                            {d > 0 ? "+" : "−"}
                            {Math.abs(d)}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Each block's best hard set, estimated. The change is against the{" "}
        {phase ? `previous ${phase.toLowerCase()} block` : "block before"}. A peak and the lighter
        block after it move these numbers: compare like phases.
      </p>
      {shownAll.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-1 inline-flex min-h-10 items-center text-[13px] font-medium text-foreground"
        >
          Show all {shownAll.length} blocks
        </button>
      )}
    </Card>
  );
}

/** Competition results, newest first: what was lifted, the total and bodyweight. */
export function MeetsList({
  meets,
  unit,
  conv,
}: {
  meets: MeetResult[];
  unit: string;
  conv: (lb: number) => number;
}) {
  const [all, setAll] = useState(false);
  if (!meets.length) return null;
  const shown = all ? meets : meets.slice(0, 4);
  return (
    <Card className="divide-y divide-border/60 p-0" data-meets-list>
      {shown.map((m) => (
        <div key={`${m.date}-${m.name}`} className="px-4 py-3 text-[13px]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate font-medium text-foreground">
              {m.name ?? "Competition"}
            </span>
            <span className="shrink-0 text-[12px] text-muted-foreground">
              {fmtDay(m.date, "MMM d, yyyy")}
            </span>
          </div>
          <div className="mt-0.5 tabular-nums text-muted-foreground">
            {COMP_LIFTS.map(
              (l) =>
                `${COMP_LIFT_LABEL[l].slice(0, 1)} ${unit === "lb" ? Math.round(conv(m.lifts[l])) : fmtNum(conv(m.lifts[l]))}`,
            ).join(" · ")}
            {" · "}
            <span className="font-medium text-foreground">
              Total {Math.round(conv(m.total)).toLocaleString()} {unit}
            </span>
            {m.bodyweightLb ? ` · BW ${fmtNum(conv(m.bodyweightLb))}` : ""}
          </div>
        </div>
      ))}
      {meets.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="flex min-h-11 w-full items-center px-4 text-[13px] font-medium text-foreground"
        >
          Show all {meets.length} meets
        </button>
      )}
    </Card>
  );
}

// ── Volume: blocks ────────────────────────────────────────────────────────

/** Working sets a week in each block (its finished weeks), as bars on one scale. */
export function BlockVolumeList({ rows }: { rows: BlockVolumeRow[] }) {
  if (rows.length < 2)
    return (
      <p className="text-sm text-muted-foreground">
        Needs two or more blocks with finished weeks in this period.
      </p>
    );
  const shown = rows.slice(-8);
  const max = Math.max(1, ...shown.map((r) => r.setsPerWeek));
  return (
    <div data-load-blocks>
      <p className="mb-2 text-xs text-muted-foreground">
        Working sets a week, each block's finished weeks
      </p>
      <ul className="space-y-2.5">
        {shown.map((r) => (
          <li key={r.id} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">{r.name}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">{r.setsPerWeek}</span> a week
                {r.hardShare != null ? ` · ${r.hardShare}% hard` : ""}
              </span>
            </div>
            <div className="mt-1 h-2">
              <span
                className="block h-full rounded-[3px] bg-[var(--chart-4)]"
                style={{ width: `${(r.setsPerWeek / max) * 100}%` }}
              />
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {fmtDay(r.start, "MMM d, yyyy")} · {r.weeks} week{r.weeks === 1 ? "" : "s"} ·{" "}
              {r.sessionsPerWeek} workouts a week
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Consistency ───────────────────────────────────────────────────────────

/** Weeks (or months, on a long period): planned workouts as the outline, done ones filled. */
function AdherenceBars({ weeks }: { weeks: AdherenceWeek[] }) {
  const monthly = weeks.length > 20;
  const shown = useMemo(() => {
    if (!monthly) return weeks;
    const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const out = new Map<string, AdherenceWeek>();
    for (const w of weeks) {
      const thu = new Date(Date.parse(`${w.key}T00:00:00Z`) + 3 * 86_400_000);
      const key = `${thu.getUTCFullYear()}-${String(thu.getUTCMonth() + 1).padStart(2, "0")}`;
      const cur = out.get(key) ?? {
        key,
        label: `${M[thu.getUTCMonth()]} ${thu.getUTCFullYear()}`,
        planned: 0,
        done: 0,
        current: false,
      };
      cur.planned += w.planned;
      cur.done += w.done;
      cur.current = cur.current || w.current;
      out.set(key, cur);
    }
    return [...out.values()];
  }, [weeks, monthly]);
  const [picked, setPicked] = useState<string | null>(null);
  if (!shown.length) return null;
  const max = Math.max(1, ...shown.map((w) => w.planned));
  const sel = shown.find((w) => w.key === picked) ?? shown[shown.length - 1];
  return (
    <div data-adherence-bars>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          Planned workouts done, by {monthly ? "month" : "week"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-foreground/75" /> Done
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-foreground/40" /> Planned
        </span>
      </div>
      <div
        className="mt-3 flex h-24 items-end gap-[3px]"
        role="img"
        aria-label="Planned workouts done each week"
      >
        {shown.map((w) => (
          <button
            key={w.key}
            type="button"
            onClick={() => setPicked(w.key)}
            onMouseEnter={() => setPicked(w.key)}
            className={cn(
              "relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm",
              sel?.key === w.key && "bg-muted/60",
            )}
            aria-label={`${w.label}: ${w.done} of ${w.planned} planned workouts done`}
          >
            <span
              className="relative mx-[2px] block rounded-t-[3px] border border-foreground/35"
              style={{ height: `${(w.planned / max) * 100}%` }}
            >
              <span
                className={cn(
                  "absolute inset-x-0 bottom-0 block rounded-t-[2px]",
                  w.current ? "bg-foreground/35" : "bg-foreground/75",
                )}
                style={{ height: `${w.planned ? (w.done / w.planned) * 100 : 0}%` }}
              />
            </span>
          </button>
        ))}
      </div>
      {sel && (
        <div className="mt-2 text-xs" data-adherence-detail>
          <span className="font-semibold">
            {sel.label}
            {sel.current ? (monthly ? " · this month" : " · this week") : ""}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {" "}
            · {sel.done} of {sel.planned} planned workouts done{sel.current ? " so far" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * How closely the program is being followed: workouts and sets against what
 * was written for days that have passed (a day still ahead is never missed),
 * week by week, and the last 4 weeks against the 4 before.
 */
export function ConsistencySummary({
  c,
  planLoading,
  planError,
}: {
  c: Consistency;
  planLoading?: boolean;
  planError?: boolean;
}) {
  if (planLoading) return <Card className="h-[220px] jf-skeleton bg-muted/30" aria-hidden />;
  if (c.planned == null || c.planned === 0) {
    return (
      <Card className="p-4" data-consistency-empty>
        <div className="text-sm font-medium text-foreground">
          {planError
            ? "Couldn't read the program for this period"
            : "No planned workouts in this period"}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {c.logged > 0 ? `${c.logged} workout${c.logged === 1 ? "" : "s"} logged. ` : ""}
          Consistency reads the workouts your program dates on days that have passed.
        </p>
      </Card>
    );
  }
  const trend =
    c.recent && c.before
      ? `Last ${c.recent.weeks} weeks ${c.recent.pct}% · the ${c.before.weeks} before ${c.before.pct}%`
      : c.recent
        ? `Last ${c.recent.weeks} weeks ${c.recent.pct}%`
        : null;
  return (
    <Card className="space-y-4 p-4" data-consistency>
      <div className="grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <div className="text-[12px] text-muted-foreground">Workouts</div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums">
            {c.done}{" "}
            <span className="text-base font-normal text-muted-foreground">of {c.planned}</span>
          </div>
          <div className="text-[12px] text-muted-foreground">{c.pct}% of planned</div>
          <ProgressBar value={c.done ?? 0} max={c.planned} label="Planned workouts done" />
        </div>
        <div className="min-w-0">
          <div className="text-[12px] text-muted-foreground">Sets</div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums">
            {c.setsPct != null ? `${c.setsPct}%` : "—"}
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {c.setsPlanned != null
              ? `${(c.setsDone ?? 0).toLocaleString()} of ${c.setsPlanned.toLocaleString()} written`
              : "—"}
          </div>
          <ProgressBar value={c.setsDone ?? 0} max={c.setsPlanned ?? 0} label="Written sets done" />
        </div>
      </div>
      {c.weeks.length >= 2 && <AdherenceBars weeks={c.weeks} />}
      {trend && (
        <p className="text-[13px] text-foreground/85" data-consistency-trend>
          {trend}
        </p>
      )}
    </Card>
  );
}

/** Advanced cards, mounted only once opened (they read their own data). */
export function MoreDetail({
  label = "More detail",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-more-detail>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between rounded-xl border border-border px-4 text-[14px] font-medium text-foreground transition hover:bg-muted/40"
      >
        {label}
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="mt-4 space-y-6">{children}</div>}
    </div>
  );
}

/**
 * For anyone who isn't a powerlifter, Strength's first answer: each lift with
 * enough hard sessions in the period and how far its estimated max moved,
 * from a stated day. The biggest gain first; nothing shown without a trend.
 */
export function LiftsMovingCard({
  data,
  unit,
  conv,
}: {
  data: LiftsTrending;
  unit: string;
  conv: (lb: number) => number;
}) {
  const [all, setAll] = useState(false);
  if (!data.tracked) {
    return (
      <Card className="p-4 text-sm text-muted-foreground" data-lifts-moving-empty>
        No lift has enough hard sets in this period to read a trend yet. It needs 4 or more sessions
        over 3+ weeks with sets at RPE 7 or harder.
      </Card>
    );
  }
  const shown = all ? data.lifts : data.lifts.slice(0, 6);
  return (
    <Card className="divide-y divide-border/60 p-0" data-lifts-moving>
      {shown.map(({ name, trend }) => {
        const diff = Math.round(conv(trend.last) - conv(trend.first));
        const up = trend.kind === "up";
        return (
          <div key={name} className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-[13px]">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">{name}</div>
              <div className="truncate text-[12px] text-muted-foreground">
                Est. max {Math.round(conv(trend.last))} {unit} · {trend.sessions} hard sessions
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div
                className={cn(
                  "font-semibold tabular-nums",
                  up ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
                )}
              >
                {trend.kind === "steady"
                  ? "Same"
                  : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} ${unit}`}
              </div>
              <div className="text-[11px] text-muted-foreground">
                since {fmtDay(trend.firstDate)}
              </div>
            </div>
          </div>
        );
      })}
      {data.lifts.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="flex min-h-11 w-full items-center px-4 text-[13px] font-medium text-foreground"
        >
          Show all {data.lifts.length} lifts
        </button>
      )}
    </Card>
  );
}
