/**
 * The small pictures a package is read by, shared by the Sessions and
 * Billing tabs so a package looks the same in both: a segmented session bar
 * (completed in green, booked in grey, still to book empty), the same bar
 * split by what payments cover (paid for in green, delivered but not paid
 * for yet in amber), a plain payment bar (paid against the package's
 * total), its two statuses as words with a dot, and the two roles a package
 * can have right now (training now, paying now).
 */
import type { ReactNode } from "react";
import { CalendarCheck, Wallet } from "lucide-react";
import {
  PAYMENT_STATUS_LABEL,
  TRAINING_STATUS_LABEL,
  paymentStatusTone,
  type CoverageCell,
  type PaymentStatus,
  type StatusTone,
  type TrainingStatus,
} from "@/lib/package-status";
import { cn } from "@/lib/utils";

const CELL = "h-2.5 min-w-0 rounded-full";

/** Columns for a row of cells: one row up to 16, else rows of 16 (or fewer when the count divides evenly). */
function columns(count: number): number {
  if (count <= 16) return Math.max(count, 1);
  for (const c of [16, 12, 10, 8]) if (count % c === 0) return c;
  return 16;
}

/** One cell per session: completed (green), booked (grey), still to book (empty), expired (dashed). */
export function SessionBar({ completed, booked, available, expired = 0, className }: {
  completed: number;
  booked: number;
  available: number;
  expired?: number;
  className?: string;
}) {
  const cells: Array<"done" | "booked" | "open" | "expired"> = [
    ...Array(Math.max(0, completed)).fill("done"),
    ...Array(Math.max(0, booked)).fill("booked"),
    ...Array(Math.max(0, available)).fill("open"),
    ...Array(Math.max(0, expired)).fill("expired"),
  ];
  if (!cells.length) cells.push("open");
  return (
    <div
      role="img"
      aria-label={`${completed} completed, ${booked} booked, ${available} available${expired ? `, ${expired} expired` : ""}`}
      className={cn("grid gap-[3px]", className)}
      style={{ gridTemplateColumns: `repeat(${columns(cells.length)}, minmax(0, 1fr))` }}
      data-session-bar
    >
      {cells.map((c, i) => (
        <span
          key={i}
          data-cell={c}
          className={cn(
            CELL,
            c === "done" && "bg-success",
            c === "booked" && "bg-foreground/35",
            c === "open" && "border border-muted-foreground/40",
            c === "expired" && "border border-dashed border-muted-foreground/60",
          )}
        />
      ))}
    </div>
  );
}

/**
 * One continuous bar split into parts (completed then booked, or paid), on an
 * empty track: the compact reading, where a cell per session would be noise.
 */
export function SegmentBar({ parts, total, label, className }: {
  parts: Array<{ value: number; tone: "done" | "booked" | "unpaid" }>;
  total: number;
  label: string;
  className?: string;
}) {
  const sum = Math.max(total, parts.reduce((t, p) => t + Math.max(0, p.value), 0), 1);
  return (
    <div role="img" aria-label={label} className={cn("flex h-2 w-full overflow-hidden rounded-full bg-border", className)} data-segment-bar>
      {parts.map((p, i) =>
        p.value > 0 ? (
          <span
            key={i}
            data-part={p.tone}
            className={cn(
              "h-full first:rounded-l-full last:rounded-r-full",
              p.tone === "done" && "bg-success",
              p.tone === "booked" && "bg-foreground/35",
              p.tone === "unpaid" && "bg-warning",
              i > 0 && "border-l-2 border-card",
            )}
            style={{ width: `${(Math.max(0, p.value) / sum) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

const COVERAGE_WORDS: Record<CoverageCell, string> = {
  paid: "paid for",
  part: "partly paid for",
  unpaid: "delivered, not paid for yet",
  free: "free",
  booked: "booked",
  open: "available",
  expired: "expired",
};

/** The same session bar, its completed sessions split by what payments cover (an accounting split, said in the legend). */
export function CoverageBar({ cells, className }: { cells: CoverageCell[]; className?: string }) {
  const counts = new Map<CoverageCell, number>();
  for (const c of cells) counts.set(c, (counts.get(c) ?? 0) + 1);
  const label = [...counts].map(([c, k]) => `${k} ${COVERAGE_WORDS[c]}`).join(", ");
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("grid gap-[3px]", className)}
      style={{ gridTemplateColumns: `repeat(${columns(cells.length || 1)}, minmax(0, 1fr))` }}
      data-coverage-bar
    >
      {cells.map((c, i) =>
        c === "part" ? (
          <span key={i} data-cell={c} className={cn(CELL, "flex overflow-hidden")}>
            <span className="h-full w-1/2 bg-success" />
            <span className="h-full w-1/2 bg-warning" />
          </span>
        ) : (
          <span
            key={i}
            data-cell={c}
            className={cn(
              CELL,
              c === "paid" && "bg-success",
              c === "unpaid" && "bg-warning",
              c === "free" && "border border-success",
              c === "booked" && "bg-foreground/35",
              c === "open" && "border border-muted-foreground/40",
              c === "expired" && "border border-dashed border-muted-foreground/60",
            )}
          />
        ),
      )}
    </div>
  );
}

/** Paid against the package's total: one plain bar. */
export function PaymentBar({ paidCents, totalCents, className }: { paidCents: number; totalCents: number; className?: string }) {
  const pct = totalCents > 0 ? Math.max(0, Math.min(100, (paidCents / totalCents) * 100)) : paidCents > 0 ? 100 : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={`${Math.round(pct)}% paid`}
      className={cn("h-2.5 w-full overflow-hidden rounded-full bg-border", className)}
      data-payment-bar
    >
      <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A legend under a bar: a swatch per state shown. */
export function BarLegend({ items, className }: { items: Array<{ swatch: "done" | "booked" | "open" | "unpaid" | "expired"; text: string }>; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground", className)} data-bar-legend>
      {items.map((i) => (
        <li key={i.text} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "h-2 w-3 shrink-0 rounded-full",
              i.swatch === "done" && "bg-success",
              i.swatch === "booked" && "bg-foreground/35",
              i.swatch === "open" && "border border-muted-foreground/40",
              i.swatch === "unpaid" && "bg-warning",
              i.swatch === "expired" && "border border-dashed border-muted-foreground/60",
            )}
          />
          {i.text}
        </li>
      ))}
    </ul>
  );
}

const TONE_TEXT: Record<StatusTone, string> = {
  done: "text-success",
  neutral: "text-muted-foreground",
  attention: "text-warning",
  error: "text-destructive",
};
const TONE_DOT: Record<StatusTone, string> = {
  done: "bg-success",
  neutral: "bg-muted-foreground",
  attention: "bg-warning",
  error: "bg-destructive",
};

const TRAINING_TONE: Record<TrainingStatus, StatusTone> = {
  upcoming: "neutral",
  training: "neutral",
  in_progress: "neutral",
  fully_booked: "neutral",
  completed: "done",
  expired: "attention",
  cancelled: "neutral",
};

/** A status as a dot and its words: quiet unless it's news. */
export function StatusText({ tone, children, className, ...rest }: { tone: StatusTone; children: ReactNode; className?: string } & Record<`data-${string}`, unknown>) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[13px]", TONE_TEXT[tone], className)} {...rest}>
      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      <span className="truncate">{children}</span>
    </span>
  );
}

export function TrainingStatusText({ status, className }: { status: TrainingStatus; className?: string }) {
  return <StatusText tone={TRAINING_TONE[status]} className={className} data-training-status={status}>{TRAINING_STATUS_LABEL[status]}</StatusText>;
}

export function PaymentStatusText({ status, auto, className }: { status: PaymentStatus; auto?: boolean; className?: string }) {
  return (
    <StatusText tone={paymentStatusTone(status, auto)} className={className} data-payment-status={status}>
      {status === "due" && auto ? "Payment due · auto-pay" : PAYMENT_STATUS_LABEL[status]}
    </StatusText>
  );
}

/** "Training now" / "Paying now": what a package is doing at the moment, a neutral tag. */
export function RoleTag({ role }: { role: "training" | "paying" }) {
  const Icon = role === "training" ? CalendarCheck : Wallet;
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-secondary px-2 text-[12px] font-medium text-foreground"
      data-role-tag={role}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {role === "training" ? "Training now" : "Paying now"}
    </span>
  );
}
