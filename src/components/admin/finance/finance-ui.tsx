import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ChevronDown, ChevronRight, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getBooksData } from "@/lib/business-books.functions";
import type { BooksData, OpenSaleRow, RevenueRow } from "@/lib/business-books";
import { fmtCad } from "@/lib/business-tax";
import { BOOKS_KEY } from "@/components/admin/books/use-snap-receipts";
import { daysBetween, methodLabel, shortDay } from "./finance-charts";

/** The books payload every finance page reads (one shared cache with Taxes & Books). */
export function useBooksData() {
  const loadFn = useServerFn(getBooksData);
  return useQuery({
    queryKey: BOOKS_KEY,
    queryFn: () => loadFn() as Promise<BooksData>,
    staleTime: 30_000,
  });
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" }) {
  return (
    <Card className="min-w-0 p-3 sm:p-4">
      <div className="truncate text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate text-xl font-semibold tabular-nums sm:text-2xl", tone === "good" && "text-emerald-500", tone === "warn" && "text-amber-500")}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

/** A card with a title row (and optional right-hand figure) and an optional "View all" footer. */
export function Section({ title, right, footer, className, children, flush }: {
  title: ReactNode;
  right?: ReactNode;
  footer?: { label: string; to?: string; search?: Record<string, string>; onClick?: () => void } | null;
  className?: string;
  children: ReactNode;
  /** Lists run edge to edge; charts and text get padding. */
  flush?: boolean;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col overflow-hidden p-0", className)}>
      <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-3.5">
        <h3 className="min-w-0 truncate text-sm font-semibold">{title}</h3>
        {right && <div className="shrink-0 text-xs text-muted-foreground">{right}</div>}
      </div>
      <div className={cn("min-w-0 flex-1", !flush && "px-4 pb-4")}>{children}</div>
      {footer && (
        footer.to ? (
          <Link to={footer.to as any} search={footer.search as any} className="flex items-center justify-center gap-1 border-t px-4 py-2.5 text-xs font-semibold text-primary hover:bg-muted/40">
            {footer.label} <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <button type="button" onClick={footer.onClick} className="flex items-center justify-center gap-1 border-t px-4 py-2.5 text-xs font-semibold text-primary hover:bg-muted/40">
            {footer.label} <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )
      )}
    </Card>
  );
}

/**
 * Money owed, one line per sale. Tapping a line opens its two jobs (record a
 * payment, send a payment link) so the list stays short until it's needed.
 */
export function CollectList({ rows, today, onRecord, onSend }: {
  rows: OpenSaleRow[];
  today: string;
  onRecord: (row: OpenSaleRow) => void;
  onSend: (row: OpenSaleRow) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!rows.length) {
    return (
      <div className="flex items-center gap-2 px-4 pb-4 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nothing outstanding.
      </div>
    );
  }
  return (
    <ul className="divide-y border-t">
      {rows.map((o) => {
        const open = openId === o.id;
        const age = o.createdOn ? daysBetween(o.createdOn, today) : null;
        return (
          <li key={o.id}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : o.id)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{o.client ?? "Client"}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {o.status ? `${o.status} · ` : ""}{o.offer ?? "Purchase"}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums">{fmtCad(o.outstandingMinor)}</div>
                {o.createdOn && (
                  <div className={cn("text-[11px] tabular-nums text-muted-foreground", age != null && age > 30 && "font-medium text-amber-600 dark:text-amber-400")}>
                    since {shortDay(o.createdOn)}
                  </div>
                )}
              </div>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
            </button>
            {open && (
              <div className="flex gap-2 px-4 pb-3">
                <Button size="sm" variant="outline" className="h-8 flex-1" onClick={() => onRecord(o)}>
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Record payment
                </Button>
                <Button size="sm" variant="outline" className="h-8 flex-1" onClick={() => onSend(o)}>
                  <Send className="mr-1.5 h-3.5 w-3.5" /> Send link
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One payment or refund: date, who and what, how, amount. */
export function PaymentLine({ r }: { r: RevenueRow }) {
  const refund = r.kind === "refund";
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">{shortDay(r.date)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{r.clientName ?? "Client"}</div>
        <div className="truncate text-xs text-muted-foreground">
          {refund ? "Refund" : r.product ?? "Payment"} · {methodLabel(r.method)}
        </div>
      </div>
      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", refund && "text-destructive")}>
        {refund ? "−" : ""}{fmtCad(r.grossMinor)}
      </span>
    </li>
  );
}
