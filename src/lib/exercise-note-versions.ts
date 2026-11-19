/**
 * An exercise note's edits, read one way for the athlete's notes sheet, the
 * coach's chat card and the coach's notes log (pure, tested).
 *
 * A note is one row (pl_exercise_notes) that's edited in place: `created_at`
 * is the day it was written and never changes, `edited_at` is when its words
 * last changed. Every wording an edit replaced is a row in
 * pl_exercise_note_revisions (`written_at` = when that wording was saved),
 * written by the database (20270419090000_exercise_note_edits.sql).
 */

export type NoteDates = {
  created_at?: string | null;
  edited_at?: string | null;
  updated_at?: string | null;
  status?: string | null;
};

export type NoteRevision = {
  id: string;
  content: string;
  written_at: string;
  replaced_at: string;
};

export type NoteVersion = {
  id: string;
  content: string;
  /** When this wording was saved. */
  at: string;
  /** The words the note was first written with. */
  original: boolean;
};

/** Edits from before edit history was kept left no earlier wording behind. */
export const NOTE_HISTORY_SINCE = "Nov 19, 2026";

/** When the note's words last changed, or null if they never have. */
export function noteEditedAt(n: NoteDates | null | undefined): string | null {
  if (!n) return null;
  if (n.edited_at) return n.edited_at;
  // a note edited before edited_at existed (and not backfilled yet)
  return n.status === "edited" ? n.updated_at ?? null : null;
}

export function isNoteEdited(n: NoteDates | null | undefined): boolean {
  return !!noteEditedAt(n);
}

function validDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Nov 10", or "Nov 10, 2025" in another year. */
export function noteDay(iso: string | null | undefined, now: Date = new Date()): string {
  const d = validDate(iso);
  if (!d) return "";
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.getFullYear() === now.getFullYear() ? day : `${day}, ${d.getFullYear()}`;
}

/** "Nov 10, 6:05 PM" (the year added outside this one): one version's time. */
export function noteMoment(iso: string | null | undefined, now: Date = new Date()): string {
  const d = validDate(iso);
  if (!d) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${noteDay(iso, now)}, ${time}`;
}

/** "Edited 2:14 PM" today, else "Edited Nov 19" (with the year outside this one); null if never edited. */
export function editedLabel(n: NoteDates | null | undefined, now: Date = new Date()): string | null {
  const at = validDate(noteEditedAt(n));
  if (!at) return null;
  if (sameDay(at, now)) return `Edited ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  return `Edited ${noteDay(at.toISOString(), now)}`;
}

/**
 * The wordings an edit replaced, oldest first. The first one is the original
 * when it was saved when the note was written; a note first edited before
 * history was kept starts at a later wording instead.
 */
export function earlierVersions(
  note: Pick<NoteDates, "created_at">,
  revisions: readonly NoteRevision[] | null | undefined,
): NoteVersion[] {
  const created = validDate(note.created_at)?.getTime() ?? null;
  return [...(revisions ?? [])]
    .filter((r) => r && typeof r.content === "string" && r.content.trim() !== "")
    .sort((a, b) => Date.parse(a.written_at) - Date.parse(b.written_at) || Date.parse(a.replaced_at) - Date.parse(b.replaced_at))
    .map((r, i) => ({
      id: r.id,
      content: r.content,
      at: r.written_at,
      original: i === 0 && created != null && Math.abs(Date.parse(r.written_at) - created) < 2000,
    }));
}

/** Edited, but the note's first words weren't kept (edited before history existed). */
export function originalNotKept(note: NoteDates, versions: readonly NoteVersion[]): boolean {
  return isNoteEdited(note) && !versions.some((v) => v.original);
}
