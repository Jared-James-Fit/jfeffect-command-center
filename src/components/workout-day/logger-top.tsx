import { useLayoutEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, StickyNote } from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import { cleanDayTitle } from "@/lib/workout-today";
import { formatClientDayNotes, formatDaySubtitle } from "@/lib/workout-day-label";
import { blockNameParts } from "@/lib/training-roadmap";
import { cn } from "@/lib/utils";

/**
 * The top of the workout logger, above the first exercise (Nov 18 2026): the
 * workout's name is the title (the name they tapped on Workouts), one quiet
 * line says where it sits ("Day 1 · General Strength · Week 3") and, when it
 * matters, when it was planned; the coach's notes are a compact block that
 * opens in place. Pure helpers are exported for the tests.
 */

type DayLike = { title?: string | null; subtitle?: string | null; day_index?: number | null };

/** The workout's name: the coach's subtitle, else its title, without stale dates; "Day 1" only when it has no name. */
export function loggerTitle(day: DayLike | null | undefined): string {
  return cleanDayTitle(formatDaySubtitle(day) ?? day?.title ?? null, day?.day_index ?? null);
}

/** "Day 1 · General Strength · Week 3": where it sits, each part once (the day's number only when the title isn't it). */
export function loggerMeta(
  day: DayLike | null | undefined,
  block: { name?: string | null } | null | undefined,
  week: { week_index?: number | null } | null | undefined,
): string {
  const title = loggerTitle(day);
  const dayPart = day?.day_index != null && !/^day\s*\d+$/i.test(title) ? `Day ${day.day_index}` : null;
  const blockPart = blockNameParts(block?.name)?.name ?? null;
  const weekPart = week?.week_index != null ? `Week ${week.week_index}` : null;
  return [dayPart, blockPart, weekPart].filter(Boolean).join(" · ");
}

/** When a workout opened on another day was planned: "tomorrow", "yesterday", "Thu, Nov 19" (with the year when it isn't this one). */
export function scheduledDayWords(scheduled: Date, today: Date): string {
  const diff = differenceInCalendarDays(scheduled, today);
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return format(scheduled, scheduled.getFullYear() === today.getFullYear() ? "EEE, MMM d" : "EEE, MMM d, yyyy");
}

/**
 * A workout opened on a day other than its planned one: one quiet line under
 * the header's meta (never an amber card), saying when it was planned, that it
 * can be done today, and that doing so keeps its day on the calendar.
 */
export function ScheduledDayLine({ scheduled, today }: { scheduled: Date; today: Date }) {
  return (
    <span className="mt-1 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground" data-scheduled-day>
      <CalendarDays className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Scheduled for <span className="font-medium text-foreground">{scheduledDayWords(scheduled, today)}</span>. You can still do it today, and its day stays the same.
      </span>
    </span>
  );
}

/**
 * The coach's notes for the whole session, only those marked client-visible.
 * Up to three lines of the first paragraph (usually the day's station order)
 * show as they are; anything longer, and every paragraph after it, opens in
 * place with a tap. No card border, no caps label, no red link.
 */
export function DayCoachNotes({ day }: { day: { notes?: string | null; notes_client_visible?: boolean | null } | null }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const leadRef = useRef<HTMLParagraphElement | null>(null);
  const notes = formatClientDayNotes(day);
  const lead = notes?.lead ?? "";

  // Whether the first paragraph runs past its three lines (measured, so a short
  // one never gets a "More" that opens nothing).
  useLayoutEffect(() => {
    const el = leadRef.current;
    if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lead, open]);

  if (!notes) return null;
  const expandable = clipped || !!notes.detail;
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <StickyNote className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        Coach notes
        {expandable && (
          <span className="ml-auto inline-flex items-center gap-0.5 text-[12px] font-medium text-muted-foreground">
            {open ? "Less" : "More"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
          </span>
        )}
      </span>
      <p
        ref={leadRef}
        className={cn("mt-1 whitespace-pre-wrap text-[13px] leading-snug text-foreground/90", !open && "line-clamp-3")}
        data-coach-notes-lead
      >
        {notes.lead}
      </p>
      {open && notes.detail && (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-snug text-muted-foreground">{notes.detail}</p>
      )}
    </>
  );
  const shell = "block w-full rounded-xl bg-muted/50 px-3 py-2.5 text-left";
  return expandable ? (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className={cn(shell, "transition-colors active:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      data-coach-notes
    >
      {body}
    </button>
  ) : (
    <div className={shell} data-coach-notes>
      {body}
    </div>
  );
}
