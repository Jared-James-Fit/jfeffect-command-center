/**
 * What deleting a program from the client's Training tab will do, in words, before the coach
 * taps. A program with logged workouts is never deleted (every set logged in it would go with
 * it): it's archived, off their program and calendar, its history kept and restorable from the
 * Workout archive (`deleteBlock`, pl-programs.ts). Pure.
 */
import { format, parseISO } from "date-fns";

export type DeleteProgramFacts = {
  name: string | null;
  firstName: string | null;
  weeks: number | null;
  /** workouts (days) in it */
  workouts: number | null;
  /** any logged set or finished workout in it */
  logged: boolean;
  archived: boolean;
  /** its dates on the calendar, when it has any */
  start: string | null;
  end: string | null;
  today: string;
};

export type DeleteProgramCopy = {
  title: string;
  lines: string[];
  /** the button: null when there's nothing to do */
  action: string | null;
  outcome: "delete" | "archive" | "none";
};

function day(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d");
  } catch {
    return iso;
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function deleteProgramCopy(f: DeleteProgramFacts): DeleteProgramCopy {
  const name = f.name?.trim() || "this program";
  const who = f.firstName?.trim() || "They";
  const their = f.firstName?.trim() ? `${f.firstName.trim()}'s` : "their";
  if (f.logged && f.archived) {
    return {
      title: `"${name}" is kept as history`,
      lines: [`${who} logged workouts in it, so it stays in their history. It's already archived and off ${their} calendar.`],
      action: null,
      outcome: "none",
    };
  }
  if (f.logged) {
    return {
      title: `Archive "${name}"?`,
      lines: [
        `${who} logged workouts in it, so it isn't deleted: that would wipe every set they logged.`,
        `Archiving takes it off ${their} program and calendar. Their logged sets stay in their history, and you can restore it from Workout archive.`,
      ],
      action: "Archive program",
      outcome: "archive",
    };
  }
  const size = [f.weeks ? plural(f.weeks, "week") : null, f.workouts != null ? plural(f.workouts, "workout") : null].filter(Boolean).join(" · ");
  const onCalendar = f.end && f.end >= f.today && f.start;
  return {
    title: `Delete "${name}"?`,
    lines: [
      size ? `${size}, nothing logged yet.` : "Nothing logged in it yet.",
      onCalendar ? `Its workouts come off ${their} calendar (${day(f.start!)} – ${day(f.end!)}).` : "It isn't on the calendar.",
      "This can't be undone.",
    ],
    action: "Delete program",
    outcome: "delete",
  };
}
