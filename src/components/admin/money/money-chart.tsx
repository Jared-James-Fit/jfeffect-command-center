/**
 * Sales, spending and profit by month: sales and spending as side-by-side
 * bars, profit as a line, one dollar axis. Every bar is full strength (a dimmed
 * bar on a dark screen reads as missing); when the chart shows months around
 * the period, the period's own months sit on a shaded band with their labels
 * bold. Tapping a month opens that month. A table of the same numbers is one
 * tap away.
 */
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import type { MonthPoint } from "@/lib/books/money-view";
import { shortMonthOf } from "@/lib/books/period";
import { money, shortMoney } from "./money-ui";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longMonth = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };

function Key({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {line ? <span className="h-0.5 w-3.5 rounded-full" style={{ background: color }} /> : <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />}
      {label}
    </span>
  );
}

function ChartTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p: MonthPoint = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-[12px] text-popover-foreground shadow-sm">
      <div className="mb-1 font-semibold">{longMonth(p.month)}</div>
      <div className="flex justify-between gap-6"><Key color="var(--money-in)" label="Sales" /><span className="tabular-nums">{money(p.salesMinor)}</span></div>
      <div className="flex justify-between gap-6"><Key color="var(--money-out)" label="Spent" /><span className="tabular-nums">{money(p.spentMinor)}</span></div>
      <div className="flex justify-between gap-6 font-medium"><Key color="var(--money-profit)" label="Profit" line /><span className="tabular-nums">{money(p.profitMinor)}</span></div>
    </div>
  );
}

export function MoneyChart({ points, inPeriod, onPickMonth }: {
  points: MonthPoint[];
  /** Months inside the selected period (full strength). */
  inPeriod: (ym: string) => boolean;
  onPickMonth?: (ym: string) => void;
}) {
  const [table, setTable] = useState(false);
  const rows = points.map((p) => ({ ...p, label: shortMonthOf(p.month), sales: p.salesMinor / 100, spent: p.spentMinor / 100, profit: p.profitMinor / 100 }));
  const anyLoss = points.some((p) => p.profitMinor < 0);
  const shown = points.filter((p) => inPeriod(p.month));
  // Shade the period only when the chart shows months outside it.
  const band = shown.length && shown.length < points.length ? { x1: shown[0].month, x2: shown[shown.length - 1].month } : null;
  const Tick = ({ x, y, payload }: any) => {
    const ym = String(payload?.value ?? "");
    const on = !!band && inPeriod(ym);
    return (
      <text x={x} y={y + 12} textAnchor="middle" fontSize={11} fill={on ? "var(--foreground)" : "var(--muted-foreground)"} fontWeight={on ? 600 : 400}>
        {shortMonthOf(ym)}
      </text>
    );
  };

  return (
    <div className="min-w-0" data-money-chart>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <Key color="var(--money-in)" label="Sales" />
          <Key color="var(--money-out)" label="Spent" />
          <Key color="var(--money-profit)" label="Profit" line />
        </div>
        <button type="button" className="underline-offset-2 hover:underline" onClick={() => setTable(!table)} data-chart-table-toggle>
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-[13px]" data-chart-table>
            <thead className="text-left text-[12px] text-muted-foreground">
              <tr><th className="py-1.5 font-medium">Month</th><th className="py-1.5 text-right font-medium">Sales</th><th className="py-1.5 text-right font-medium">Spent</th><th className="py-1.5 text-right font-medium">Profit</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...points].reverse().map((p) => (
                <tr key={p.month} className={cn(!inPeriod(p.month) && "text-muted-foreground")}>
                  <td className="py-1.5">
                    {onPickMonth ? <button type="button" className="hover:underline" onClick={() => onPickMonth(p.month)}>{longMonth(p.month)}</button> : longMonth(p.month)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.salesMinor)}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.spentMinor)}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.profitMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-56 min-w-0" role="img" aria-label="Sales, spending and profit by month">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              margin={{ top: 6, right: 2, left: 0, bottom: 0 }}
              barGap={2}
              barCategoryGap="18%"
              onClick={(e: any) => {
                const ym = e?.activePayload?.[0]?.payload?.month;
                if (ym && onPickMonth) onPickMonth(ym);
              }}
              style={{ cursor: onPickMonth ? "pointer" : undefined }}
            >
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              {band ? <ReferenceArea x1={band.x1} x2={band.x2} fill="var(--muted)" fillOpacity={0.7} strokeOpacity={0} ifOverflow="extendDomain" /> : null}
              <XAxis dataKey="month" tick={<Tick />} tickLine={false} axisLine={false} interval={rows.length <= 12 ? 0 : "preserveStartEnd"} minTickGap={2} height={22} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => shortMoney(v * 100)} />
              {anyLoss ? <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} /> : null}
              <Tooltip content={<ChartTip />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
              <Bar dataKey="sales" fill="var(--money-in)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              <Bar dataKey="spent" fill="var(--money-out)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              <Line dataKey="profit" type="monotone" stroke="var(--money-profit)" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: "var(--card)", fill: "var(--money-profit)" }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
