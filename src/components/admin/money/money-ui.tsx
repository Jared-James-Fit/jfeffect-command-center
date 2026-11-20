/**
 * The money screens' building blocks, in the design system's language:
 * 16px sentence-case card titles, plain numbers in the text colours, colour
 * only where it means something (green up on what's good, amber needs a
 * look, red overdue).
 */
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { fmtCad } from "@/lib/business-tax";
import type { Change } from "@/lib/books/money-view";

export const money = fmtCad;

/** $950, $3.2k, $12k: for axis ticks and tight lines. */
export function shortMoney(minor: number): string {
  const v = minor / 100;
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 10_000) return `${sign}$${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

export const pctWord = (n: number) => `${Math.round(n * 100)}%`;

const WHOLE = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0, minimumFractionDigits: 0 });

/** $1,124: a figure in a small tile, rounded to the dollar (the exact one is a tap away). */
export const wholeMoney = (minor: number) => WHOLE.format(Math.round(minor / 100)).replace("-", "−");

export function MoneyCard({ title, icon: Icon, action, children, className, id }: {
  title: ReactNode;
  icon?: typeof Info;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <Card id={id} className={cn("min-w-0 rounded-2xl p-4", className)}>
      <div className="mb-3 flex min-h-6 items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-[16px] font-semibold">
          {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
          <span className="truncate">{title}</span>
        </h3>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </Card>
  );
}

/** What a figure means, one tap away (never a wall of definitions on the page). */
export function Definition({ children, label = "What this means" }: { children: ReactNode; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className="-m-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-[13px] leading-snug">{children}</PopoverContent>
    </Popover>
  );
}

/**
 * How a figure moved against the comparison period, in words. `good` says
 * which way is good news (sales up, spending down); only good news is green,
 * and bad news stays plain (it isn't an error).
 */
export function ChangeLine({ change, good, vs }: { change: Change | null; good: "up" | "down" | "none"; vs: string | null }) {
  if (!change || !vs) return null;
  // Nothing to compare with (a period before the books start): say so, no arrow, no %.
  if (change.pct == null && change.direction !== "flat") {
    return <div className="truncate text-[12px] text-muted-foreground" data-change="none">None in {vs}</div>;
  }
  const Icon = change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : Minus;
  const isGood = good !== "none" && change.direction === good;
  const amount = change.pct != null && Math.abs(change.pct) < 10
    ? `${Math.round(Math.abs(change.pct) * 100)}%`
    : shortMoney(Math.abs(change.diffMinor));
  return (
    <div className={cn("flex min-w-0 items-center gap-1 text-[12px]", isGood ? "text-success" : "text-muted-foreground")} data-change={change.direction}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{change.direction === "flat" ? `Same as ${vs}` : `${amount} vs ${vs}`}</span>
    </div>
  );
}

export function Stat({ label, value, sub, change, good = "up", vs, tone, definition, onClick, testId }: {
  label: string;
  value: string;
  sub?: ReactNode;
  change?: Change | null;
  good?: "up" | "down" | "none";
  vs?: string | null;
  tone?: "good" | "warn" | "bad";
  definition?: ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
        <span className="truncate">{label}</span>
        {definition ? <span className="pointer-events-auto relative z-10"><Definition>{definition}</Definition></span> : null}
      </div>
      <div className={cn("mt-0.5 truncate text-[22px] font-semibold tabular-nums leading-tight sm:text-[26px]", tone === "good" && "text-success", tone === "warn" && "text-warning", tone === "bad" && "text-destructive")}>
        {value}
      </div>
      {change !== undefined ? <ChangeLine change={change ?? null} good={good} vs={vs ?? null} /> : null}
      {sub ? <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{sub}</div> : null}
    </>
  );
  const cls = "min-w-0 rounded-2xl border border-border bg-card p-3.5 text-left sm:p-4";
  // A tappable tile is a button laid under its words, so the ⓘ inside stays its own button.
  return onClick ? (
    <div className={cn(cls, "relative transition-colors hover:bg-muted/40")} data-money-stat={testId}>
      <button type="button" onClick={onClick} aria-label={label} className="absolute inset-0 rounded-2xl" />
      <div className="pointer-events-none relative">{body}</div>
    </div>
  ) : (
    <div className={cls} data-money-stat={testId}>{body}</div>
  );
}

/** A thin share bar under a row: what part of the biggest one this is. */
export function ShareBar({ share, color }: { share: number; color: string }) {
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.round(Math.min(1, share) * 100))}%`, background: color }} />
    </div>
  );
}

export type RankItem = { key: string; label: string; minor: number; sub?: string };

/** A ranked list, each row with its share of the top one. Tapping a row filters by it. */
export function RankList({ rows, color, empty, onPick, total }: {
  rows: RankItem[];
  color: string;
  empty: string;
  onPick?: (key: string) => void;
  total?: number;
}) {
  if (!rows.length) return <p className="text-[14px] text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.minor)), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const share = total && total > 0 ? r.minor / total : null;
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-[14px]">
              <span className="min-w-0 leading-snug">
                {r.label}
                {r.sub ? <span className="ml-1.5 text-[12px] text-muted-foreground">{r.sub}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums">
                {money(r.minor)}
                {share != null ? <span className="ml-1.5 text-[12px] text-muted-foreground">{pctWord(share)}</span> : null}
              </span>
            </div>
            <ShareBar share={Math.abs(r.minor) / max} color={color} />
          </>
        );
        return (
          <li key={r.key} className="min-w-0">
            {onPick ? (
              <button type="button" className="w-full rounded-lg text-left hover:bg-muted/30" onClick={() => onPick(r.key)}>{inner}</button>
            ) : inner}
          </li>
        );
      })}
    </ul>
  );
}

/** A label and a figure on one line (statements, breakdowns). */
export function Line({ label, value, strong, muted, sub }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean; sub?: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5 text-[14px]", strong && "font-semibold", muted && "text-muted-foreground")}>
      <span className="min-w-0">
        {label}
        {sub ? <span className="block text-[12px] font-normal text-muted-foreground">{sub}</span> : null}
      </span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}
