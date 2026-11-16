import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KindFamily } from "@/lib/calendar-sources";
import type { HomeView } from "@/lib/calendar-prefs";
import { dayTag, monthGridDays } from "@/lib/home-calendar";
import { chipTime } from "@/lib/calendar-labels";
import { compareInstants } from "@/lib/schedule-time";
import { AGENDA_ROW, AgendaEmpty, AgendaLoading, AgendaNextRow, AgendaToday, FAMILY_ACCENT, hasEnded, startLabel } from "./agenda";

/**
 * The views every Home calendar card offers, the coach's and a client's
 * alike (Day · Week · Month · List), and the pieces they share: the switch
 * with the period, a month of who / what is on each day, and the week as a
 * list. Each card maps its own rows onto `HomeEntry` and wraps a row in
 * whatever it opens (the coach's session sheet, a client's session view).
 */
export const HOME_VIEW_OPTIONS: Array<{ id: HomeView; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "list", label: "List" },
];

/** One thing on a Home calendar card, whoever's card it is. */
export type HomeEntry = {
  key: string;
  date: string;
  /** Null = all day (or any time). */
  startsAt: string | null;
  endsAt: string | null;
  family: KindFamily;
  /** The bold part: who (the coach's card) or what (a client's). */
  title: string;
  /** A month chip or a narrow week column: a first name, or the title. */
  short: string;
  /** A phone's month chip, when it differs from `short`: a client's "10:30a". */
  tiny?: string | null;
  /** After the title on the List's line: what it is, or where. */
  what: string | null;
  status?: string | null;
};

/** Crossed out in a list or a month, as on the timeline: it isn't happening (or didn't). */
export const STRUCK_STATUSES = new Set(["Cancelled", "Missed"]);

/** By day, then all day first, then by time. */
export function byDayThenTime(a: HomeEntry, b: HomeEntry): number {
  return (
    a.date.localeCompare(b.date) ||
    (a.startsAt ? 1 : 0) - (b.startsAt ? 1 : 0) ||
    compareInstants(a.startsAt, b.startsAt) ||
    a.title.localeCompare(b.title)
  );
}

/**
 * Day · Week · Month · List (neutral, like every in-card switch: red is the
 * card's one action), then the period on screen with Today, ‹ ›. When both
 * don't fit on one line (a phone) the period takes its own line under the
 * switch, whole, never cut to "To…".
 */
export function HomeViewBar({
  view, onView, label, onStep, onToday,
}: {
  view: HomeView;
  onView: (v: HomeView) => void;
  label: string;
  onStep: (dir: -1 | 1) => void;
  onToday: (() => void) | null;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="inline-flex h-8 shrink-0 rounded-full border border-border bg-background/60 p-0.5 text-xs font-semibold" role="radiogroup" aria-label="Calendar view">
        {HOME_VIEW_OPTIONS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={view === v.id}
            onClick={() => onView(v.id)}
            className={cn("rounded-full px-2.5 sm:px-3", view === v.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="flex min-w-[12.5rem] flex-1 items-center gap-0.5" data-home-period>
        <span className="mr-auto whitespace-nowrap text-[13px] font-semibold tabular-nums" aria-live="polite">{label}</span>
        {onToday && (
          <button type="button" onClick={onToday} className="mr-0.5 shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
            Today
          </button>
        )}
        <button type="button" onClick={() => onStep(-1)} aria-label="Previous" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary/60 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => onStep(1)} aria-label="Next" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary/60 hover:text-foreground">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** A month chip per family: the timeline blocks' colours, smaller. */
const MONTH_CHIP: Record<KindFamily, string> = {
  people: "border-violet-500 bg-violet-500/15",
  coach: "border-amber-500 bg-amber-500/15",
  training: "border-foreground/50 bg-foreground/[0.07]",
  google: "border-muted-foreground/40 bg-muted text-foreground/75",
};

/**
 * The month as whole weeks: each day's date (today filled) and what's on it,
 * a line each in order (up to 3, then "+N"): a first name on the coach's,
 * what it is on a client's. A day opens its timeline.
 */
export function HomeMonth({
  anchor, today, onPick, names,
}: {
  anchor: string;
  today: string;
  onPick: (d: string) => void;
  /** What's on a day, in the order to show (cancelled ones left out). */
  names: (d: string) => HomeEntry[];
}) {
  const days = monthGridDays(anchor);
  const month = anchor.slice(0, 7);
  return (
    <div className="mt-2.5" role="group" aria-label="Month">
      <div className="grid grid-cols-7 pb-0.5 text-center text-[11px] font-medium text-muted-foreground" aria-hidden>
        {days.slice(0, 7).map((d) => (
          <span key={d}>{new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 border-t border-border/60">
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === month;
          const isToday = d === today;
          const list = names(d);
          const shown = list.slice(0, 3);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              aria-label={`${new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${isToday ? " (today)" : ""}${list.length ? `: ${list.map((r) => `${r.startsAt ? startLabel(r.startsAt) + " " : ""}${r.title}`).join(", ")}` : ""}`}
              className={cn(
                "flex min-h-[68px] min-w-0 flex-col items-stretch justify-start gap-px border-b border-border/60 px-px pb-1 pt-0.5 transition hover:bg-secondary/40 active:bg-secondary/60",
                !inMonth && "opacity-40",
              )}
            >
              <span
                className={cn(
                  "mx-auto grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums",
                  isToday ? "bg-foreground text-background" : d < today ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {Number(d.slice(8))}
              </span>
              {shown.map((r) => (
                <span
                  key={r.key}
                  aria-hidden
                  className={cn(
                    "block truncate rounded-sm border-l-2 px-0.5 text-left text-[9px] font-semibold leading-[13px] text-foreground sm:text-[10px] sm:leading-[14px]",
                    MONTH_CHIP[r.family],
                    d < today && "opacity-55",
                  )}
                >
                  <span className="hidden font-normal tabular-nums text-foreground/70 sm:inline">{r.startsAt ? `${chipTime(r.startsAt)} ` : ""}</span>
                  {r.tiny ? (
                    <>
                      <span className="sm:hidden">{r.tiny}</span>
                      <span className="hidden sm:inline">{r.short}</span>
                    </>
                  ) : (
                    r.short
                  )}
                </span>
              ))}
              {list.length > shown.length && <span aria-hidden className="px-0.5 text-left text-[9px] font-semibold leading-3 text-muted-foreground">+{list.length - shown.length}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The week as a list, one line each, by day ("Mon 16 · 10:30 AM Marc Asugui ·
 * 1:1 Training"): compact, for a quick look at what's on when, without a full
 * timeline. Cancelled and no-shows crossed out, ended ones quieter.
 */
export function HomeWeekList({
  rows, today, nowMs, loading, emptyText, label, wrap,
}: {
  /** The week's entries, in order (`byDayThenTime`). */
  rows: HomeEntry[];
  today: string;
  nowMs: number;
  loading: boolean;
  emptyText: string;
  label: string;
  /** A row opens what it is: render the tap target around its line. */
  wrap: (entry: HomeEntry, className: string, line: ReactNode) => ReactNode;
}) {
  return (
    <AgendaToday>
      {loading ? (
        <AgendaLoading />
      ) : rows.length === 0 ? (
        <AgendaEmpty>{emptyText}</AgendaEmpty>
      ) : (
        <ol aria-label={label} data-home-list>
          {rows.map((r, i) => {
            const firstOfDay = i === 0 || rows[i - 1].date !== r.date;
            return (
              <li key={r.key} className={cn("min-w-0", firstOfDay && i > 0 && "mt-1 border-t border-border/40 pt-1")}>
                {wrap(
                  r,
                  cn(AGENDA_ROW, hasEnded(r.startsAt, r.endsAt, nowMs) && "opacity-55"),
                  <AgendaNextRow
                    dayText={firstOfDay ? dayTag(r.date, today) : ""}
                    accent={FAMILY_ACCENT[r.family]}
                    time={r.startsAt ? startLabel(r.startsAt) : "All day"}
                    title={<span className={cn(STRUCK_STATUSES.has(r.status ?? "") && "text-muted-foreground line-through")}>{r.title}</span>}
                    quiet={r.family === "google"}
                    suffix={r.what ? <span className="font-normal text-muted-foreground"> · {r.what}</span> : null}
                  />,
                )}
              </li>
            );
          })}
        </ol>
      )}
    </AgendaToday>
  );
}
