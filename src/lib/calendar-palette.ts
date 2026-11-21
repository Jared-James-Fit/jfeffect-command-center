/**
 * How calendar items look, everywhere a calendar shows (the coach's Calendar
 * page and Home card, a client's calendar, the week strip's dots), from one
 * place so the views never drift apart. Pure.
 *
 * JF Effect's calendar is black, white and grey (Nov 21 2026): the theme's own
 * ink (`foreground`: off-white in dark mode, near-black in light) marks what's
 * booked, so a session with the coach is the strongest thing on the page;
 * training is the same ink, lighter; something from the coach (an event, a key
 * date, a check-in) is an outline with no fill; the person's own Google
 * events are muted grey. Red is never a calendar colour: it stays for the
 * screen's one main action (today's Start), so nothing on a calendar reads as
 * overdue. Status never rests on colour alone (`statusMark`): done carries a
 * check, a no-show or cancel is dashed and crossed out with its word, and
 * what's still ahead is a plain solid block.
 */
import type { KindFamily } from "./calendar-sources";

/** A timeline block (Day / Week): an edge, a tint, the theme's own text. */
export const FAMILY_BLOCK: Record<KindFamily, string> = {
  people: "border-foreground bg-foreground/[0.10] hover:bg-foreground/[0.16]",
  training: "border-foreground/45 bg-foreground/[0.05] hover:bg-foreground/[0.10]",
  coach: "border-foreground/70 bg-transparent ring-1 ring-inset ring-foreground/20 hover:bg-foreground/[0.06]",
  google: "border-muted-foreground/40 bg-muted text-foreground/80 hover:bg-muted/70",
};

/** A month cell's line per item: the timeline's colours, smaller. */
export const FAMILY_MONTH_CHIP: Record<KindFamily, string> = {
  people: "border-foreground bg-foreground/[0.10]",
  training: "border-foreground/45 bg-foreground/[0.05]",
  coach: "border-foreground/70 bg-transparent",
  google: "border-muted-foreground/40 bg-muted text-foreground/75",
};

/** A list row's hairline and the week strip's dot under a day. */
export const FAMILY_ACCENT: Record<KindFamily, string> = {
  people: "bg-foreground",
  training: "bg-foreground/50",
  coach: "bg-foreground/80",
  google: "bg-muted-foreground/35",
};

/** A legend / filter chip and its dot (the Calendar page's kinds). */
export const FAMILY_CHIP: Record<KindFamily, { chip: string; dot: string }> = {
  people: { chip: "bg-foreground/10 text-foreground border-foreground/40", dot: "bg-foreground" },
  training: { chip: "bg-foreground/[0.05] text-foreground border-foreground/25", dot: "bg-foreground/50" },
  coach: { chip: "bg-transparent text-foreground border-foreground/50", dot: "bg-transparent ring-1 ring-inset ring-foreground/70" },
  google: { chip: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/45" },
};

export type StatusMark = "done" | "struck" | null;

/**
 * What a status adds beside the colour: a check for done, crossed out for a
 * cancel, a no-show or a move, nothing for what's still on. Case doesn't
 * matter (sessions say "Completed", appointments "completed").
 */
export function statusMark(status: string | null | undefined): StatusMark {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "completed" || s === "done") return "done";
  if (s === "cancelled" || s === "canceled" || s === "missed" || s === "no_show" || s === "no-show" || s === "rescheduled") return "struck";
  return null;
}

/** The word a crossed-out item says, so it never rests on the line through it. */
export function statusWord(status: string | null | undefined): string | null {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "missed" || s === "no_show" || s === "no-show") return "No-show";
  if (s === "cancelled" || s === "canceled") return "Cancelled";
  if (s === "rescheduled") return "Moved";
  if (s === "completed" || s === "done") return "Done";
  return null;
}
