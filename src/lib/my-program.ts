/**
 * A JF member's programs, in words: where the program on their calendar came
 * from, whether it's theirs to change, and what ending it does. Pure (tested
 * in my-program.test.ts); the screens are ManageProgramSheet, the Workouts
 * program card and the Programs hub.
 *
 * Who owns a block (`pl_blocks.created_by`), not the tier, decides who may
 * change it: a plan a member started or a program they built is theirs, a
 * coach's program is the coach's.
 */
import { format, parseISO } from "date-fns";

export type ProgramOrigin =
  /** a JF Effect plan they started (pl_blocks.source_template_id = member_plans.source_template_id) */
  | { kind: "jf"; templateId: string }
  /** a program they built or copied from the crew (pl_blocks.source_athlete_program_id) */
  | { kind: "own"; programId: string }
  /** written by a coach (someone else made the block) */
  | { kind: "coach" }
  /** theirs, but where it came from wasn't recorded */
  | { kind: "unknown" };

export type OwnedBlock = {
  id: string;
  created_by?: string | null;
  source_template_id?: string | null;
  source_athlete_program_id?: string | null;
};

export type ProgramOwnership = {
  /** every block of the program is the member's own */
  owned: boolean;
  origin: ProgramOrigin;
  /** the block that stands for the program (member_program_end takes its siblings with it) */
  blockId: string | null;
};

/** Where the program made of `blockIds` came from, and whether `userId` may change it. */
export function programOwnership(
  blocks: OwnedBlock[],
  blockIds: string[],
  userId: string | null | undefined,
): ProgramOwnership {
  const mine = blocks.filter((b) => blockIds.includes(b.id));
  if (!mine.length || !userId)
    return { owned: false, origin: { kind: "unknown" }, blockId: mine[0]?.id ?? null };
  const owned = mine.every((b) => b.created_by === userId);
  if (!owned) return { owned: false, origin: { kind: "coach" }, blockId: mine[0].id };
  const own = mine.find((b) => b.source_athlete_program_id)?.source_athlete_program_id ?? null;
  if (own) return { owned: true, origin: { kind: "own", programId: own }, blockId: mine[0].id };
  const tpl = mine.find((b) => b.source_template_id)?.source_template_id ?? null;
  if (tpl) return { owned: true, origin: { kind: "jf", templateId: tpl }, blockId: mine[0].id };
  return { owned: true, origin: { kind: "unknown" }, blockId: mine[0].id };
}

/** One short line under a program's name: where it came from. */
export function originLabel(
  origin: ProgramOrigin["kind"],
  opts: { copiedFrom?: string | null } = {},
): string {
  switch (origin) {
    case "jf":
      return "JF Effect plan";
    case "own":
      return opts.copiedFrom ? `Your copy of ${opts.copiedFrom}'s program` : "Built by you";
    case "coach":
      return "Written by your coach";
    default:
      return "Your program";
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso.slice(0, 10)), "MMM d");
  } catch {
    return null;
  }
}

/** "Week 4 of 12 · Ends Jan 10", "Starts Nov 16", "Finished Jan 10". */
export function programProgressLine(p: {
  programWeek: number | null;
  totalWeeks: number;
  start: string | null;
  end: string | null;
  today: string;
}): string {
  if (p.end && p.end < p.today) return `Finished ${day(p.end) ?? ""}`.trim();
  if (p.start && p.start > p.today) {
    return [`Starts ${day(p.start) ?? "soon"}`, p.totalWeeks ? plural(p.totalWeeks, "week") : null]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    p.programWeek && p.totalWeeks ? `Week ${p.programWeek} of ${p.totalWeeks}` : null,
    day(p.end) ? `Ends ${day(p.end)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** How far through the program today is, 0–1 (for one thin bar). */
export function programProgress(p: {
  programWeek: number | null;
  totalWeeks: number;
  start: string | null;
  end: string | null;
  today: string;
}): number {
  if (p.end && p.end < p.today) return 1;
  if (!p.programWeek || !p.totalWeeks) return 0;
  return Math.min(1, Math.max(0, p.programWeek / p.totalWeeks));
}

/** What member_program_end reports before anything changes. */
export type EndFacts = {
  name: string;
  /** the program's history key (its pl_preps id, else its block's id) */
  key?: string | null;
  /** workouts with a logged set or finished */
  logged: number;
  /** workouts from today on with nothing logged */
  upcoming: number;
};

export type EndCopy = { title: string; lines: string[]; action: string };

/**
 * Ending a program, said before the tap. Nothing is deleted any more: the
 * program moves to their program history (resume or start over from there),
 * and what they logged stays in their history, PRs and progress.
 */
export function endProgramCopy(f: EndFacts): EndCopy {
  const name = f.name?.trim() || "this program";
  const lines: string[] = [];
  lines.push(
    f.upcoming > 0
      ? `Its ${plural(f.upcoming, "upcoming workout")} come${f.upcoming === 1 ? "s" : ""} off your calendar.`
      : "Nothing from it is left on your calendar.",
  );
  lines.push("It moves to your program history, where you can resume it or start it over.");
  lines.push(
    f.logged > 0
      ? `The ${plural(f.logged, "workout")} you logged stay${f.logged === 1 ? "s" : ""} in your history, PRs and progress.`
      : "You haven't logged a workout in it yet.",
  );
  return { title: `End ${name}?`, lines, action: "End program" };
}

/** After it ended (with Undo beside it). */
export function endedToast(f: { name: string; logged?: number }): string {
  const name = f.name?.trim() || "Program";
  return `${name} ended. It's in your program history.`;
}

/** After it was paused (with Undo beside it). */
export function pausedToast(f: { name: string; upcoming: number }): string {
  const name = f.name?.trim() || "Program";
  return f.upcoming > 0
    ? `${name} paused. Its ${plural(f.upcoming, "upcoming workout")} ${f.upcoming === 1 ? "is" : "are"} off your calendar until you resume.`
    : `${name} paused. Resume it any time.`;
}

/** What "Save" on a program changes, said where the button is. */
export function savedEditLine(
  r: { updated: number; added: number; removed: number; kept: number } | null,
): string {
  if (!r) return "Saved";
  const changed = r.updated + r.added + r.removed;
  if (!changed) return "Saved. Nothing upcoming on your calendar needed changing.";
  const kept = r.kept ? ` Workouts you've done or started stay as they were.` : "";
  return `Saved. ${plural(changed, "upcoming workout")} on your calendar updated.${kept}`;
}

/** Your programs, split by where they came from (the hub's My programs sections). */
export function splitOwnPrograms<T extends { forked_from: { id: string | null } | null }>(
  programs: T[],
): {
  built: T[];
  copied: T[];
} {
  const built: T[] = [];
  const copied: T[] = [];
  for (const p of programs) (p.forked_from ? copied : built).push(p);
  return { built, copied };
}

/** What starting a program does to the one on their calendar. */
export type SwitchFacts = {
  /** the program starting */
  title: string;
  /** the program on their calendar now, if any */
  current: string | null;
  /** it's the same program again (starting over) */
  same?: boolean;
  /** the current program is done (nothing left in it) */
  currentFinished?: boolean;
  /** from member_program_end's preview, when known */
  logged?: number | null;
  upcoming?: number | null;
};

export type SwitchCopy = {
  kind: "start" | "switch" | "restart";
  /** the sheet's title */
  title: string;
  /** what happens to the current program, one line each; empty for a first start */
  lines: string[];
  /** the one button */
  action: string;
};

/** The start / switch sheet in words: what starts, and what happens to what's running. */
export function switchCopy(f: SwitchFacts): SwitchCopy {
  const title = f.title?.trim() || "this program";
  const current = f.current?.trim() || null;
  if (!current)
    return { kind: "start", title: `Start ${title}`, lines: [], action: "Start program" };
  const kept =
    f.logged == null
      ? "Every workout you finished stays in your history and PRs."
      : f.logged > 0
        ? `The ${plural(f.logged, "workout")} you finished stay${f.logged === 1 ? "s" : ""} in your history and PRs.`
        : "You haven't finished a workout in it yet.";
  if (f.same) {
    return {
      kind: "restart",
      title: `Start ${title} over`,
      lines: [
        "It starts again from week 1 on the date you pick. This run moves to your program history.",
        kept,
      ],
      action: "Start over",
    };
  }
  const goes = f.currentFinished
    ? `${current} is finished and moves to your program history.`
    : f.upcoming != null && f.upcoming > 0
      ? `${current} moves to your program history. Its ${plural(f.upcoming, "upcoming workout")} come${f.upcoming === 1 ? "s" : ""} off your calendar.`
      : `${current} moves to your program history.`;
  return {
    kind: "switch",
    title: `Switch to ${title}`,
    lines: [goes, kept],
    action: "Switch program",
  };
}

/** Under a program's main button while another one is running. */
export function replacesLine(current: string | null | undefined): string | null {
  const c = current?.trim();
  return c ? `Replaces ${c}, which moves to your program history.` : null;
}

/* ── Program history ─────────────────────────────────────────────────── */

/** One past program, as member_program_history() reads it. */
export type HistoryEntry = {
  /** its pl_preps id for a program of several blocks, else its block's id */
  key: string;
  name: string;
  reason: "paused" | "ended" | "switched";
  /** the day it came off their calendar (their clock) */
  off_on: string;
  off_at?: string | null;
  start: string | null;
  end: string | null;
  blocks: number;
  weeks: number;
  total: number;
  done: number;
  /** workouts still to do (never opened, nothing logged, not already missed before it came off) */
  remaining: number;
  last_trained: string | null;
  next: { week: number; day: number; title: string | null } | null;
  days_per_week: number | null;
  template_id: string | null;
  /** the JF Effect plan it came from, while it's still in the library */
  plan_id: string | null;
  /** their own program it came from, while it still exists */
  program_id: string | null;
  origin: "jf" | "own" | "unknown";
  copied: boolean;
  can_resume: boolean;
};

function dayYear(iso: string | null | undefined, today: string): string | null {
  if (!iso) return null;
  try {
    const d = parseISO(iso.slice(0, 10));
    return format(d, iso.slice(0, 4) === today.slice(0, 4) ? "MMM d" : "MMM d, yyyy");
  } catch {
    return null;
  }
}

/** A past program that has nothing left to do and every workout done. */
export function historyCompleted(e: Pick<HistoryEntry, "remaining" | "done" | "total">): boolean {
  return e.remaining === 0 && e.total > 0 && e.done >= e.total;
}

/** "Paused Nov 18", "Switched Nov 3", "Ended Nov 3", "Completed Jan 10". */
export function historyStatus(e: HistoryEntry, today: string): string {
  const when = dayYear(e.off_on, today) ?? "";
  if (historyCompleted(e)) return `Completed ${when}`.trim();
  const word =
    e.reason === "paused" && e.remaining > 0
      ? "Paused"
      : e.reason === "switched"
        ? "Switched"
        : "Ended";
  return `${word} ${when}`.trim();
}

/** "6 of 36 workouts done · Nov 2 – Dec 11". */
export function historyProgressLine(e: HistoryEntry, today: string): string {
  const start = dayYear(e.start, today);
  const end = dayYear(e.off_on && e.end && e.off_on < e.end ? e.off_on : e.end, today);
  const range = start && end ? `${start} – ${end}` : start ? `from ${start}` : null;
  return [`${e.done} of ${plural(e.total, "workout")} done`, range].filter(Boolean).join(" · ");
}

/** "Picks up at Week 3 · Day 2 (Lower A)". The workout's own name only when it says more than "Day 2". */
export function historyNextLine(e: Pick<HistoryEntry, "next">): string | null {
  if (!e.next) return null;
  const t = e.next.title?.trim();
  const named = t && !/^day\s*\d+$/i.test(t) ? ` (${t})` : "";
  return `Picks up at Week ${e.next.week} · Day ${e.next.day}${named}`;
}

/** What a past program offers: Resume where they left off, Start over from week 1 (from its source). */
export function historyActions(
  e: HistoryEntry,
  opts: { member: boolean },
): { resume: boolean; restart: "plan" | "program" | null } {
  if (!opts.member) return { resume: false, restart: null };
  return {
    resume: e.can_resume && e.remaining > 0,
    restart: e.plan_id ? "plan" : e.program_id ? "program" : null,
  };
}

/** The program to offer back on Workouts: the latest paused one that can resume, while nothing else runs. */
export function pausedProgram(
  history: HistoryEntry[] | null | undefined,
  running: boolean,
): HistoryEntry | null {
  if (running) return null;
  return (
    (history ?? []).find((e) => e.reason === "paused" && e.can_resume && e.remaining > 0) ?? null
  );
}

/** The resume sheet in words. */
export function resumeCopy(f: {
  name: string;
  next: HistoryEntry["next"];
  remaining: number;
  current: string | null;
}): SwitchCopy {
  const name = f.name?.trim() || "this program";
  const lines: string[] = [];
  const next = historyNextLine({ next: f.next });
  lines.push(`${next ? `${next}. ` : ""}${plural(f.remaining, "workout")} left.`);
  const current = f.current?.trim();
  if (current) lines.push(`${current} moves to your program history.`);
  lines.push("Workouts you already did keep their dates.");
  return { kind: "switch", title: `Resume ${name}`, lines, action: "Resume program" };
}

/** Removing a past program from the history list, said before the tap. */
export function removeFromHistoryCopy(e: Pick<HistoryEntry, "name" | "done">): EndCopy {
  return {
    title: `Remove ${e.name?.trim() || "this program"} from your history?`,
    lines: [
      "It leaves this list, so you can't resume it from here.",
      e.done > 0
        ? `The ${plural(e.done, "workout")} you logged in it stay${e.done === 1 ? "s" : ""} in your training history, PRs and progress.`
        : "You never logged a workout in it.",
    ],
    action: "Remove",
  };
}

/** Deleting a program they built or copied (never a JF Effect plan or someone else's), said before the tap. */
export function deleteSavedProgramCopy(p: {
  title: string;
  shared: boolean;
  running: boolean;
}): EndCopy {
  const lines = [
    p.shared
      ? "It's removed from My programs and from the crew."
      : "It's removed from My programs.",
    "Workouts you logged from it stay in your history and PRs. Copies other people saved stay theirs.",
  ];
  if (p.running)
    lines.push("It stays on your calendar. To take it off, use End program in Manage.");
  return { title: `Delete ${p.title?.trim() || "this program"}?`, lines, action: "Delete program" };
}
