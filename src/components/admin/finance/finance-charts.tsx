import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtCad } from "@/lib/business-tax";
import { cn } from "@/lib/utils";

export type PeriodBar = { key: string; label: string; valueMinor: number; hint?: string };

const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };
const kTick = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));

/**
 * One series over time (months or weeks). The current period is in the brand
 * colour and the rest are grey, so the eye lands on "now" and compares back.
 * No legend: the card title names the series. Values are dollars on hover.
 */
export function PeriodBars({ data, highlight, height = 176, ariaLabel }: {
  data: PeriodBar[];
  highlight?: string;
  height?: number;
  ariaLabel: string;
}) {
  const rows = data.map((d) => ({ ...d, dollars: Math.round(d.valueMinor / 100) }));
  return (
    <div className="min-w-0" style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 0, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={4} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={34} tickFormatter={kTick} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            formatter={(_v: number, _n, item: any) => [fmtCad(item?.payload?.valueMinor ?? 0), item?.payload?.hint ?? "Total"]}
            labelFormatter={(l) => String(l)}
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }}
          />
          <Bar dataKey="dollars" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.key} fill={r.key === highlight ? "var(--primary)" : "var(--muted-foreground)"} fillOpacity={r.key === highlight ? 1 : 0.32} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export type RankRow = { label: string; valueMinor: number; sub?: string };

/**
 * A short ranked list where each row carries a thin bar for its share of the
 * biggest one: readable at a glance, exact values printed, no legend needed.
 */
export function RankBars({ rows, empty = "Nothing yet.", tone = "primary" }: {
  rows: RankRow[];
  empty?: string;
  tone?: "primary" | "warn";
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.valueMinor), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {r.label}
              {r.sub && <span className="ml-1 text-xs text-muted-foreground">{r.sub}</span>}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{fmtCad(r.valueMinor)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", tone === "warn" ? "bg-amber-500" : "bg-primary")}
              style={{ width: `${Math.max(2, Math.round((r.valueMinor / max) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-08" -> "Oct 8". */
export const shortDay = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1] ?? ""} ${Number(iso.slice(8, 10))}`;
/** "2026-10" -> "Oct". */
export const shortMonth = (ym: string) => MON[Number(ym.slice(5, 7)) - 1] ?? ym;
/** "2026-10" -> "October 2026". */
export const longMonth = (ym: string) =>
  `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(ym.slice(5, 7)) - 1] ?? ""} ${ym.slice(0, 4)}`;

/** Compact dollars for sub-lines: $950, $3.2k. */
export const shortCad = (minor: number) => {
  const v = minor / 100;
  return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
};

export const methodLabel = (m: string | null) =>
  !m ? "Other" : m === "etransfer" ? "E-transfer" : m.charAt(0).toUpperCase() + m.slice(1).replace(/_/g, " ");

/** Whole days between two YYYY-MM-DD dates (b - a). */
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
