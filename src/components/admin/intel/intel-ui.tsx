/**
 * The pieces the admin intelligence pages (Usage & spend, App & website, Membership) are built
 * from: one look, so a number, a meter or a chart reads the same on every page.
 *
 * Rules (the design system's, plus the dataviz method's):
 * - The important number is the biggest thing in its card; its comparison sits right under it.
 * - Colour means something: amber needs a look, red is a problem, green is done. Series colours
 *   are --viz-1..3 (validated), at most three in a chart, always with a legend; text never wears
 *   a series colour.
 * - Every chart has a hover read-out and a table view, and one y-axis.
 */
import { useId, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  ComposedChart,
} from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, OctagonAlert, Table2, BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function IntelSection({
  id,
  title,
  sub,
  action,
  children,
  className,
}: {
  id?: string;
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card id={id} className={cn("min-w-0 scroll-mt-24 p-4 md:p-5", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          {sub && <p className="mt-0.5 text-[13px] text-muted-foreground">{sub}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </Card>
  );
}

export type Tone = "neutral" | "good" | "warn" | "bad";

export function Kpi({
  label,
  value,
  sub,
  delta,
  deltaGood = "up",
  tone = "neutral",
  meter,
  to,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number | null;
  /** Which way is good for this number (costs: down). */
  deltaGood?: "up" | "down" | "neither";
  tone?: Tone;
  meter?: { pct: number | null; marks?: number[] } | null;
  to?: string;
  onClick?: () => void;
}) {
  const body = (
    <div
      className={cn(
        "h-full rounded-2xl border bg-card p-4 transition-colors",
        (to || onClick) && "hover:bg-muted/40",
        tone === "bad" && "border-destructive/40",
        tone === "warn" && "border-amber-500/40",
      )}
    >
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight md:text-[28px]">{value}</span>
        {delta != null && <Delta pct={delta} good={deltaGood} />}
      </div>
      {meter && <Meter pct={meter.pct} marks={meter.marks} className="mt-2.5" />}
      {sub && <div className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{sub}</div>}
    </div>
  );
  if (to) return <Link to={to as any} className="block h-full">{body}</Link>;
  if (onClick)
    return (
      <button type="button" onClick={onClick} className="block h-full w-full text-left">
        {body}
      </button>
    );
  return body;
}

/** A signed change, with an arrow; amber only when it moved the wrong way by a lot. */
export function Delta({ pct, good = "up" }: { pct: number; good?: "up" | "down" | "neither" }) {
  if (!Number.isFinite(pct)) return null;
  const up = pct > 0;
  const bad = good !== "neither" && ((good === "up" && pct <= -25) || (good === "down" && pct >= 25));
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums",
        bad ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
      )}
      title="Against the same number of days before"
    >
      {pct !== 0 && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

/** A budget meter: neutral under 80%, amber to 100%, red past it; marks at 80% and 100%. */
export function Meter({ pct, marks = [80], className }: { pct: number | null; marks?: number[]; className?: string }) {
  const p = pct == null ? 0 : Math.max(0, pct);
  const fill = Math.min(100, p);
  const tone = p >= 100 ? "bg-destructive" : p >= 80 ? "bg-amber-500" : "bg-foreground/70";
  return (
    <div
      className={cn("relative h-2 overflow-hidden rounded-full bg-muted", className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p)}
    >
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct == null ? 0 : Math.max(2, fill)}%` }} />
      {marks.map((m) => (
        <span key={m} className="absolute top-0 h-full w-px bg-background/80" style={{ left: `${m}%` }} aria-hidden />
      ))}
    </div>
  );
}

export function PeriodSwitch<T extends string | number>({
  value,
  options,
  onChange,
  label = "Period",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-9 rounded-md px-3 text-[13px] font-medium transition-colors",
            o.value === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type IntelAlert = {
  key: string;
  tone: "critical" | "warning" | "info";
  title: string;
  body: string;
  action?: { label: string; to?: string; hash?: string };
};

/** What needs a look, most serious first; nothing at all when nothing does. */
export function AlertList({ alerts, max = 4 }: { alerts: IntelAlert[]; max?: number }) {
  const [all, setAll] = useState(false);
  if (!alerts.length) return null;
  const shown = all ? alerts : alerts.slice(0, max);
  return (
    <div className="space-y-2" role="list" aria-label="Needs a look">
      {shown.map((a) => {
        const Icon = a.tone === "critical" ? OctagonAlert : a.tone === "warning" ? AlertTriangle : Info;
        return (
          <div
            key={a.key}
            role="listitem"
            className={cn(
              "flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center",
              a.tone === "critical" && "border-destructive/40 bg-destructive/5",
              a.tone === "warning" && "border-amber-500/40 bg-amber-500/5",
            )}
          >
            <Icon
              className={cn(
                "hidden h-5 w-5 shrink-0 sm:block",
                a.tone === "critical" ? "text-destructive" : a.tone === "warning" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold leading-snug">{a.title}</div>
              <div className="text-[13px] leading-snug text-muted-foreground">{a.body}</div>
            </div>
            {a.action && (
              <Button asChild size="sm" variant="outline" className="h-9 shrink-0 self-start sm:self-center">
                {a.action.to ? (
                  <Link to={a.action.to as any}>{a.action.label}</Link>
                ) : (
                  <a href={`#${a.action.hash}`}>{a.action.label}</a>
                )}
              </Button>
            )}
          </div>
        );
      })}
      {alerts.length > max && (
        <button type="button" onClick={() => setAll((v) => !v)} className="text-[13px] font-medium text-muted-foreground hover:text-foreground">
          {all ? "Show fewer" : `${alerts.length - max} more`}
        </button>
      )}
    </div>
  );
}

/** A chart with a "table" switch beside its legend. */
export function ChartFrame({
  legend,
  table,
  children,
  ariaLabel,
}: {
  legend?: { label: string; color: string; dashed?: boolean }[];
  table: ReactNode;
  children: ReactNode;
  ariaLabel: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
          {legend?.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              <span
                className={cn("inline-block h-2.5 w-2.5 rounded-sm", l.dashed && "h-0.5 w-3.5 rounded-none")}
                style={{ background: l.color }}
                aria-hidden
              />
              {l.label}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-pressed={asTable}
        >
          {asTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
          {asTable ? "Chart" : "Table"}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-auto rounded-lg border">{table}</div>
      ) : (
        <div role="img" aria-label={ariaLabel}>
          {children}
        </div>
      )}
    </div>
  );
}

export const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };
export const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-08" → "Nov 8". */
export const dayLabel = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1] ?? ""} ${Number(iso.slice(8, 10))}`;
/** "2026-11" → "Nov 2026". */
export const monthLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1] ?? ""} ${ym.slice(0, 4)}`;

/**
 * Stacked daily bars for up to three series (one axis), with a hover read-out. `format` prints a
 * value; the stack total is in the tooltip too.
 */
export function StackedDays({
  rows,
  series,
  format,
  height = 200,
  ariaLabel,
}: {
  rows: Record<string, any>[];
  series: { key: string; label: string; color: string }[];
  format: (v: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const data: Record<string, any>[] = rows.map((r) => ({ ...r, _label: dayLabel(String(r.day)) }));
  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      legend={series.length > 1 ? series.map((s) => ({ label: s.label, color: s.color })) : undefined}
      table={
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-card text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Day</th>
              {series.map((s) => (
                <th key={s.key} className="px-3 py-1.5 text-right font-medium">{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((r) => (
              <tr key={r.day} className="border-t">
                <td className="px-3 py-1.5">{r._label}</td>
                {series.map((s) => (
                  <td key={s.key} className="px-3 py-1.5 text-right tabular-nums">{format(Number(r[s.key] ?? 0))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="_label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => format(Number(v))} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              contentStyle={tooltipStyle}
              formatter={(v: number, name: string) => [format(Number(v)), name]}
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="a"
                fill={s.color}
                stroke="var(--card)"
                strokeWidth={series.length > 1 ? 1 : 0}
                radius={i === series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={22}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

/** One series over days as bars with a 7-day line over it (the trend under the noise). */
export function DaysWithTrend({
  rows,
  barKey,
  lineKey,
  barLabel,
  lineLabel,
  height = 200,
  ariaLabel,
  format = (v) => String(Math.round(v)),
}: {
  rows: Record<string, any>[];
  barKey: string;
  lineKey: string;
  barLabel: string;
  lineLabel: string;
  height?: number;
  ariaLabel: string;
  format?: (v: number) => string;
}) {
  const data: Record<string, any>[] = rows.map((r) => ({ ...r, _label: dayLabel(String(r.day)) }));
  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      legend={[
        { label: barLabel, color: "var(--viz-1)" },
        { label: lineLabel, color: "var(--foreground)", dashed: true },
      ]}
      table={
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-card text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Day</th>
              <th className="px-3 py-1.5 text-right font-medium">{barLabel}</th>
              <th className="px-3 py-1.5 text-right font-medium">{lineLabel}</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((r) => (
              <tr key={r.day} className="border-t">
                <td className="px-3 py-1.5">{r._label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{format(Number(r[barKey] ?? 0))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{format(Number(r[lineKey] ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="_label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} contentStyle={tooltipStyle} formatter={(v: number, name: string) => [format(Number(v)), name]} />
            <Bar dataKey={barKey} name={barLabel} fill="var(--viz-1)" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            <Line dataKey={lineKey} name={lineLabel} stroke="var(--foreground)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

/**
 * A ranked list with a thin bar per row: two parts when a row splits (AI and texts), one hue
 * otherwise. Exact values printed; a row can be a button (to filter what's below).
 */
export function RankRows<K extends string>({
  rows,
  format,
  parts,
  onPick,
  picked,
  empty = "Nothing in this period.",
}: {
  rows: { key: K; label: string; sub?: string; values: number[] }[];
  format: (v: number) => string;
  parts?: { label: string; color: string }[];
  onPick?: (k: K | null) => void;
  picked?: K | null;
  empty?: string;
}) {
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  const total = (r: { values: number[] }) => r.values.reduce((n, v) => n + v, 0);
  const max = Math.max(...rows.map(total), 1e-9);
  const colors = parts?.map((p) => p.color) ?? ["var(--viz-1)"];
  return (
    <div>
      {parts && parts.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
          {parts.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
              {p.label}
            </span>
          ))}
        </div>
      )}
      <ul className="space-y-1">
        {rows.map((r) => {
          const t = total(r);
          const content = (
            <>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{r.label}</span>
                  {r.sub && <span className="ml-1.5 text-[12px] text-muted-foreground">{r.sub}</span>}
                </span>
                <span className="shrink-0 font-medium tabular-nums">{format(t)}</span>
              </div>
              <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted" title={parts?.map((p, i) => `${p.label} ${format(r.values[i] ?? 0)}`).join(" · ")}>
                {r.values.map((v, i) => (
                  <div
                    key={i}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${(v / max) * 100}%`, background: colors[i] ?? colors[0], marginRight: i < r.values.length - 1 && v > 0 ? 2 : 0 }}
                  />
                ))}
              </div>
            </>
          );
          return (
            <li key={r.key}>
              {onPick ? (
                <button
                  type="button"
                  onClick={() => onPick(picked === r.key ? null : r.key)}
                  aria-pressed={picked === r.key}
                  className={cn("block w-full rounded-lg px-2 py-2 text-left hover:bg-muted/60", picked === r.key && "bg-muted")}
                >
                  {content}
                </button>
              ) : (
                <div className="px-2 py-2">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A funnel as stacked horizontal steps: each step's bar is its share of the first, with the
 * count and the step-to-step rate printed.
 */
export function Funnel({ steps }: { steps: { label: string; value: number; hint?: string; base?: number }[] }) {
  const first = Math.max(steps[0]?.value ?? 0, 1);
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        // a step's rate is against the step before, unless it says its own base (a cohort that's had time)
        const prev = s.base ?? (i > 0 ? steps[i - 1].value : null);
        const rate = prev ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate">
                <span className="font-medium">{s.label}</span>
                {s.hint && <span className="ml-1.5 text-[12px] text-muted-foreground">{s.hint}</span>}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{s.value}</span>
                {rate != null && <span className="ml-1.5 text-[12px] text-muted-foreground">{rate}%</span>}
              </span>
            </div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${s.value ? Math.max(2, (s.value / first) * 100) : 0}%`, background: "var(--viz-1)" }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A plain stat line for a definition list ("What the numbers mean"). */
export function Definitions({ items }: { items: { term: string; text: string }[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[13px]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-9 items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground"
      >
        <Info className="h-4 w-4" /> What the numbers mean
      </button>
      {open && (
        <dl id={id} className="mt-2 grid gap-2 sm:grid-cols-2">
          {items.map((d) => (
            <div key={d.term} className="rounded-lg bg-muted/50 p-3">
              <dt className="font-medium">{d.term}</dt>
              <dd className="mt-0.5 text-muted-foreground">{d.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
