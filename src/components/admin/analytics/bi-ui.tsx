/**
 * The Analytics section's own pieces, on top of the intelligence pages' (intel-ui.tsx): a sparkline
 * inside a KPI, a compact stat strip, a sortable data table that's also what the CSV exports, a
 * cohort heatmap, a "since when" note and a segmented control. Same rules: the important number is
 * the biggest thing, colour only where it means something, every chart has a table.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Delta } from "@/components/admin/intel/intel-ui";
import { cn } from "@/lib/utils";

export function Sparkline({ values, color = "var(--viz-1)", label }: { values: number[]; color?: string; label: string }) {
  const data = values.map((v, i) => ({ i, v }));
  if (values.length < 2 || values.every((v) => v === 0)) return <div className="h-8" aria-hidden />;
  return (
    <div className="h-8" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, right: 2, left: 2, bottom: 3 }}>
          <Line dataKey="v" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} type="monotone" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function KpiCard({
  label,
  value,
  delta,
  deltaGood = "up",
  sub,
  spark,
  sparkLabel,
  tone = "neutral",
  info,
  onClick,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  deltaGood?: "up" | "down" | "neither";
  sub?: ReactNode;
  spark?: number[];
  sparkLabel?: string;
  tone?: "neutral" | "warn" | "bad";
  info?: string;
  onClick?: () => void;
}) {
  const body = (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-card p-4 transition-colors",
        onClick && "hover:bg-muted/40",
        tone === "bad" && "border-destructive/40",
        tone === "warn" && "border-amber-500/40",
      )}
      title={info}
    >
      <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
        {label}
        {info && <Info className="h-3.5 w-3.5 opacity-60" aria-label={info} />}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight md:text-[26px]">{value}</span>
        {delta != null && <Delta pct={delta} good={deltaGood} />}
      </div>
      {sub && <div className="mt-1 text-[12px] leading-snug text-muted-foreground">{sub}</div>}
      {spark && <div className="mt-auto pt-2"><Sparkline values={spark} label={sparkLabel ?? `${label} by day`} /></div>}
    </div>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="block h-full w-full text-left">
      {body}
    </button>
  ) : (
    body
  );
}

/** A row of small figures (the secondary numbers under the headline cards). */
export function StatStrip({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border bg-card p-4 sm:grid-cols-4 lg:grid-cols-8">
      {items.map((s) => (
        <div key={s.label} className="min-w-0">
          <dt className="truncate text-[12px] text-muted-foreground">{s.label}</dt>
          <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">{s.value}</dd>
          {s.sub && <dd className="text-[11px] text-muted-foreground">{s.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

export type Column<R> = {
  key: string;
  label: string;
  render: (r: R) => ReactNode;
  sort?: (r: R) => number | string | null;
  align?: "left" | "right";
  className?: string;
};

/** A table that sorts by a column (a tap on its header), scrolls sideways on a phone, and shows `limit` rows until asked for all. */
export function DataTable<R>({
  rows,
  columns,
  rowKey,
  limit = 12,
  empty = "Nothing in this period.",
  initialSort,
}: {
  rows: R[];
  columns: Column<R>[];
  rowKey: (r: R, i: number) => string;
  limit?: number;
  empty?: string;
  initialSort?: { key: string; desc?: boolean };
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(initialSort ? { key: initialSort.key, desc: initialSort.desc ?? true } : null);
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const x = col.sort!(a);
      const y = col.sort!(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -d : d;
    });
  }, [rows, columns, sort]);
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  const shown = all ? sorted : sorted.slice(0, limit);
  return (
    <div className="min-w-0">
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead className="text-[12px] text-muted-foreground">
            <tr className="border-b">
              {columns.map((c) => (
                <th key={c.key} className={cn("whitespace-nowrap px-2 py-2 font-medium", c.align === "right" ? "text-right" : "text-left", c.className)}>
                  {c.sort ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 hover:text-foreground"
                      onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: true }))}
                      aria-label={`Sort by ${c.label}`}
                    >
                      {c.label}
                      {sort?.key === c.key && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={rowKey(r, i)} className="border-b last:border-0">
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-2 py-2 align-top", c.align === "right" ? "text-right tabular-nums" : "text-left", c.className)}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 min-h-9 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/** A cohort heatmap: one row per cohort, a cell per week or month after it, strength = share active. */
export function CohortHeatmap({ rows, unit }: { rows: { cohort: string; size: number; cells: (number | null)[] }[]; unit: "W" | "M" }) {
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">No one joined in this window yet.</p>;
  const cols = rows[0]?.cells.length ?? 0;
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-[12px]" aria-label="Share of each cohort active after joining">
        <thead className="text-muted-foreground">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Joined</th>
            <th className="px-2 py-1 text-right font-medium">People</th>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i} className="px-1 py-1 text-center font-medium">{unit}{i}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cohort}>
              <td className="whitespace-nowrap px-2 py-1">{r.cohort}</td>
              <td className="px-2 py-1 text-right tabular-nums">{r.size}</td>
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={cn("h-7 min-w-9 rounded text-center tabular-nums", c == null ? "bg-transparent text-muted-foreground/40" : "text-foreground")}
                  style={c == null ? undefined : { background: `color-mix(in oklch, var(--viz-1) ${Math.max(6, c)}%, transparent)` }}
                  title={c == null ? "Not reached yet" : `${c}% active`}
                >
                  {c == null ? "" : `${c}%`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Tracked since …": said whenever the range reaches before a source started recording. */
export function SinceNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-9 shrink-0 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors",
            o.value === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A share bar (0–100) with its number. */
export function ShareBar({ pct, tone = "neutral" }: { pct: number | null; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const color = tone === "good" ? "var(--viz-3)" : tone === "warn" ? "rgb(245 158 11)" : tone === "bad" ? "var(--destructive)" : "var(--viz-1)";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:w-24">
        <div className="h-full rounded-full" style={{ width: `${pct == null ? 0 : Math.max(2, p)}%`, background: color }} />
      </div>
      <span className="w-10 text-right tabular-nums">{pct == null ? "–" : `${pct}%`}</span>
    </div>
  );
}
