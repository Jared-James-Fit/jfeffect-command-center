import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { weekDays } from "@/components/calendar/week-strip";
import type { KindFamily } from "@/lib/calendar-sources";
import { cn } from "@/lib/utils";

/**
 * The Home calendar card, shared by every account's Home (client, coach,
 * staff). It has to read as a calendar at a glance, so it leads with a
 * calendar's own shapes: a date tile and "Calendar" (tap to open it), then
 * this Monday–Sunday week with a dot per thing (tap a day to open the calendar
 * there). Below that, today's items on a time column with one hairline of
 * colour each and a Now line, the next few things one line each, then worded
 * actions. Callers map their own data onto these rows and wrap each row in
 * whatever it opens (a link, a button, Google).
 */

/** Where a tap goes: a route plus its search params. */
export type AgendaLink = { to: string; search?: Record<string, unknown> };

/** A hairline in the item's colour family: the only colour on a row. */
export const FAMILY_ACCENT: Record<KindFamily, string> = {
  training: "bg-cyan-500",
  people: "bg-violet-500",
  coach: "bg-amber-500",
  google: "bg-slate-400/70",
};

/** Tap target for a row, whatever element it is. */
export const AGENDA_ROW = "block w-full rounded-lg py-1 text-left transition active:bg-secondary/40";
/** The footer's main action (red) and the "see everything" link (quiet). */
export const AGENDA_ACTION = "inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg px-1 text-[13px] font-semibold text-primary";
export const AGENDA_LINK = "inline-flex min-h-10 items-center gap-0.5 whitespace-nowrap rounded-lg px-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground";

const TIME_COL = "grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-2";

/** "7 AM", "12:30 PM": the time column (start only; the range goes in the subline). */
export function startLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(":00", "");
}

/** "Tmrw", "Wed 14" this week, "Nov 5" further out: the day for the first of its rows in the next-up list. */
export function shortDay(date: string, today: string): string {
  const d = new Date(`${date}T00:00:00`);
  const t = new Date(`${today}T00:00:00`);
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  if (diff === 1) return "Tmrw";
  if (diff > 6) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()}`;
}

/** Ended (timed items only), so earlier items read quieter. No end = an hour. */
export function hasEnded(startsAt: string | null | undefined, endsAt: string | null | undefined, nowMs: number): boolean {
  if (!startsAt) return false;
  const end = Date.parse(endsAt ?? "") || Date.parse(startsAt) + 60 * 60 * 1000;
  return end < nowMs;
}

/** Where "Now" falls: before the first timed row still to come, or after the last. -1 = no line. */
export function nowLineIndex(rows: Array<{ startsAt?: string | null; endsAt?: string | null }>, nowMs: number): number {
  const i = rows.findIndex((r) => !!r.startsAt && !hasEnded(r.startsAt, r.endsAt, nowMs));
  if (i > 0) return i;
  if (i === -1 && rows.some((r) => r.startsAt)) return rows.length;
  return -1;
}

/** Minute-accurate "now", so earlier items fade and the Now line moves through the day. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function AgendaCard({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn("border-border bg-card px-3.5 pb-2 pt-3", className)}>{children}</Card>;
}

/** A tear-off calendar page for today: weekday on a red band, the day's number below. */
export function DateTile({ day }: { day: string }) {
  const d = new Date(`${day}T00:00:00`);
  return (
    <span aria-hidden className="flex h-10 w-10 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-center shadow-sm">
      <span className="bg-primary py-px text-[9px] font-black uppercase leading-tight tracking-wider text-primary-foreground">
        {d.toLocaleDateString(undefined, { weekday: "short" })}
      </span>
      <span className="flex flex-1 items-center justify-center text-base font-black leading-none tabular-nums">{d.getDate()}</span>
    </span>
  );
}

/**
 * "[21] Calendar ›  /  Today · Wednesday, Oct 21". The tile and title open the
 * full calendar; `right` has room for one small control of its own.
 */
export function AgendaHeader({ today, link, right }: { today: string; link?: AgendaLink | null; right?: ReactNode }) {
  const date = new Date(`${today}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const body = (
    <>
      <DateTile day={today} />
      <span className="min-w-0">
        <span className="flex items-center gap-0.5 text-[15px] font-black leading-tight">
          Calendar {link && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </span>
        <span className="block truncate text-xs text-muted-foreground">Today · {date}</span>
      </span>
    </>
  );
  const cls = "-m-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1";
  return (
    <div className="flex items-center gap-2">
      {link ? (
        <Link to={link.to as any} search={link.search as any} aria-label="Open your calendar" className={cn(cls, "transition active:bg-secondary/40")}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
      {right}
    </div>
  );
}

/**
 * This Monday–Sunday week, like the top of a calendar: day names, dates, today
 * in a red circle and a dot per thing on the day (colour = kind, up to 3).
 * Each day opens the full calendar on that day.
 */
export function AgendaWeek({ today, dots, link }: { today: string; dots: (day: string) => string[]; link?: ((day: string) => AgendaLink) | null }) {
  return (
    <div className="mt-2.5 grid grid-cols-7 gap-0.5" role="list" aria-label="This week">
      {weekDays(today).map((d) => {
        const date = new Date(`${d}T00:00:00`);
        const isToday = d === today;
        const past = d < today;
        const marks = dots(d);
        const to = link?.(d);
        const Cell: any = to ? Link : "div";
        return (
          <Cell
            key={d}
            role="listitem"
            {...(to ? { to: to.to, search: to.search } : {})}
            aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}${isToday ? " (today)" : ""}${marks.length ? `, ${marks.length} scheduled` : ""}`}
            aria-current={isToday ? "date" : undefined}
            className={cn("flex min-h-[54px] min-w-0 flex-col items-center justify-start gap-0.5 rounded-lg pt-1", to && "transition active:bg-secondary/50")}
          >
            <span className={cn("text-[10px] font-bold uppercase tracking-wide", isToday ? "text-primary" : "text-muted-foreground")}>
              {date.toLocaleDateString(undefined, { weekday: "short" })}
            </span>
            <span
              className={cn(
                "grid h-7 w-7 place-items-center rounded-full text-sm font-black tabular-nums",
                isToday ? "bg-primary text-primary-foreground" : past ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {date.getDate()}
            </span>
            <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
              {marks.slice(0, 3).map((cls, i) => (
                <span key={i} className={cn("h-1.5 w-1.5 rounded-full", cls, past && "opacity-50")} />
              ))}
            </span>
          </Cell>
        );
      })}
    </div>
  );
}

/** Today's list, under the week: a hairline above it. */
export function AgendaToday({ children }: { children: ReactNode }) {
  return <div className="mt-1 border-t border-border/60 pt-1.5">{children}</div>;
}

export function AgendaLoading() {
  return (
    <div className="space-y-1.5 py-1" aria-hidden>
      <div className="h-9 animate-pulse rounded-lg bg-secondary/40" />
      <div className="h-9 animate-pulse rounded-lg bg-secondary/30" />
    </div>
  );
}

export function AgendaEmpty({ children }: { children: ReactNode }) {
  return <p className="px-0.5 py-1.5 text-sm text-muted-foreground">{children}</p>;
}

export function NowLine() {
  return (
    <div className={cn(TIME_COL, "items-center")} aria-label="Now">
      <span className="text-right text-[10px] font-black uppercase tracking-wider text-primary">Now</span>
      <span className="flex items-center">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="h-px flex-1 bg-primary/50" />
      </span>
    </div>
  );
}

/** Today's row: time, hairline, title (wraps to two lines), a subline and an optional action. */
export function AgendaRow({
  time, timed, accent, title, quiet, struck, sub, trailing, chevron,
}: {
  /** "7 AM", "Anytime", "All day". */
  time: string;
  /** A real clock time (brighter than Anytime / All day). */
  timed: boolean;
  accent: string;
  title: ReactNode;
  /** Google and other read-only rows: lighter title. */
  quiet?: boolean;
  /** Cancelled: crossed out. */
  struck?: boolean;
  sub?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
}) {
  return (
    <div className={cn(TIME_COL, "items-stretch")}>
      <div className={cn("whitespace-nowrap pt-0.5 text-right text-xs font-semibold tabular-nums", timed ? "text-foreground/80" : "text-muted-foreground")}>{time}</div>
      <div className="flex min-w-0 gap-2.5">
        <span aria-hidden className={cn("w-[3px] shrink-0 self-stretch rounded-full", accent)} />
        <div className="min-w-0 flex-1 py-px">
          <div className="flex items-start gap-2">
            <div
              className={cn(
                "min-w-0 flex-1 line-clamp-2 text-sm leading-snug",
                quiet ? "font-medium text-foreground/75" : "font-bold",
                struck && "text-muted-foreground line-through",
              )}
            >
              {title}
            </div>
            {chevron && !trailing && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />}
          </div>
          {(sub || trailing) && (
            <div className="mt-0.5 flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{sub}</div>
              {trailing}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A coming-up row: day (first row of each day only), hairline, "9 AM Title" on one line. */
export function AgendaNextRow({
  dayText, accent, time, title, quiet, suffix,
}: {
  dayText: string;
  accent: string;
  time?: string | null;
  title: ReactNode;
  quiet?: boolean;
  suffix?: ReactNode;
}) {
  return (
    <div className={cn(TIME_COL, "items-center")}>
      <div className="whitespace-nowrap text-right text-xs font-semibold text-muted-foreground">{dayText}</div>
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className={cn("h-4 w-[3px] shrink-0 self-center rounded-full", accent)} />
        <div className={cn("min-w-0 truncate text-[13px]", quiet ? "text-foreground/70" : "font-semibold")}>
          {time && <span className="font-normal tabular-nums text-muted-foreground">{time} </span>}
          {title}
          {suffix}
        </div>
      </div>
    </div>
  );
}

/** Divider plus the next-up list. Renders nothing when empty. */
export function AgendaNext({ children, show }: { children: ReactNode; show: boolean }) {
  if (!show) return null;
  return (
    <div className="mt-1.5 border-t border-border/60 pt-1.5">
      <ol aria-label="Coming up">{children}</ol>
    </div>
  );
}

/** Worded actions: the main one on the left, "see everything" on the right. */
export function AgendaFooter({ children }: { children: ReactNode }) {
  return <div className="mt-1 flex items-center justify-between gap-2 border-t border-border/60 pt-1">{children}</div>;
}

/** Start / Continue / Review pill, or a green Done. */
export function ActionPill({ label, done }: { label: string; done?: boolean }) {
  if (done) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-500">
        <Check className="h-3.5 w-3.5" strokeWidth={3} /> {label}
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-full bg-primary pl-2.5 pr-1.5 text-[11px] font-bold text-primary-foreground">
      {label} <ChevronRight className="h-3.5 w-3.5" />
    </span>
  );
}
