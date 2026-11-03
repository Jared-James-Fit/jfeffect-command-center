/**
 * The nutrition tools' two shapes, kept in a file of their own so a page that
 * only needs a row (the coach's grocery preview) doesn't pull in the calculator.
 */

import type { ComponentType } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type TileProps = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  busy?: boolean;
};

/**
 * One compact tool tile: a plain icon over the tool's name, nothing else (the
 * name says what it does). Two to a row on a phone; every tool looks the same
 * (neutral icon, no tint): the page's colour is for status.
 */
export function ToolTile({ icon: Icon, title, onClick, href, disabled, busy }: TileProps) {
  const className = cn(
    "flex min-h-16 w-full flex-col items-start justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:bg-muted/50 active:scale-[0.98]",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    disabled && "pointer-events-none opacity-50",
  );
  const body = (
    <>
      {busy ? (
        <Loader2 className="h-[18px] w-[18px] animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <Icon className="h-[18px] w-[18px] text-muted-foreground" aria-hidden />
      )}
      <span className="block min-w-0 text-[13px] font-semibold leading-tight">{title}</span>
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={className}>
      {body}
    </button>
  );
}

/**
 * The same tool as a full-width row (icon, name, one-line hint, chevron), for
 * a tool that belongs beside what it works on (How to weigh your food and the
 * Grocery List under the meal plan) rather than in the Tools grid.
 */
export function ToolRow({
  icon: Icon,
  title,
  hint,
  onClick,
  disabled,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:bg-muted/50 active:bg-muted/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground" aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight">{title}</span>
        {hint ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}
