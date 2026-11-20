import { painAreaParts } from "@/lib/workout-review";

/**
 * A coaching client's workout notes reach their coach in Messages: the
 * review's note, pain (where, which side, how bad) and notes on an exercise
 * each become one "workout_note" card from them in the coach chat
 * (DB triggers on pl_workout_feedback / pl_exercise_notes, coaching tier,
 * written by the athlete). The card reads the note itself, so an edit shows
 * on it; the coach's log of all of them is client_workout_notes().
 */
export type WorkoutNotePain = { area: string | null; level: number | null };

export type WorkoutNoteCardAttachment = {
  kind: "workout_note";
  source: "review" | "exercise";
  feedback_id?: string;
  note_id?: string;
  day_id?: string | null;
  row_id?: string | null;
  completion_id?: string | null;
  workout?: string | null;
  exercise?: string | null;
  at?: string | null;
  note?: string | null;
  pain?: WorkoutNotePain | null;
  rpe?: number | null;
};

/** One line in the coach's notes log. */
export type WorkoutNoteEntry = {
  id: string;
  source: "review" | "exercise";
  at: string;
  edited_at: string | null;
  day_id: string | null;
  row_id: string | null;
  workout: string | null;
  exercise: string | null;
  note: string | null;
  pain: WorkoutNotePain | null;
  rpe: number | null;
  message_id: string | null;
  /** An exercise note's earlier versions kept (pl_exercise_note_revisions). */
  versions?: number;
};

/**
 * "Left knee", "Both knees", "Neck, right shoulder" — from the review's stored
 * "Knee (L)" / "Neck, Shoulder (R)". Anything else reads as written.
 */
export function painAreaLabel(stored: string | null | undefined): string | null {
  const parts = painAreaParts(stored);
  if (!parts.length) return null;
  // later places in lower case ("Neck, right shoulder"), unless it's an acronym ("SI joint")
  return parts.map((p, i) => (i && /^[A-Z][a-z]/.test(p) ? p[0].toLowerCase() + p.slice(1) : p)).join(", ");
}

/** Same words as the review's chips: 3 Mild, 5 Moderate, 8 Sharp. */
export function painSeverityLabel(level: number | null | undefined): string | null {
  if (level == null) return null;
  if (level <= 3) return "Mild";
  if (level <= 6) return "Moderate";
  return "Sharp";
}

/** "Left knee · Moderate (5/10)". */
export function painLine(p: WorkoutNotePain | null | undefined): string | null {
  if (!p) return null;
  const area = painAreaLabel(p.area);
  const sev = painSeverityLabel(p.level);
  const parts = [area, sev && p.level != null ? `${sev} (${p.level}/10)` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Pain";
}

export type NotesFilter = "all" | "pain" | "review" | "exercise";
export const NOTES_FILTERS: { key: NotesFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pain", label: "Pain" },
  { key: "review", label: "Workout notes" },
  { key: "exercise", label: "Exercise notes" },
];
export function matchesNotesFilter(e: Pick<WorkoutNoteEntry, "source" | "pain">, f: NotesFilter): boolean {
  if (f === "all") return true;
  if (f === "pain") return !!e.pain;
  return e.source === f;
}

/** Push the coach about a note card the athlete just sent (deduped per message, so calling it again is harmless). */
export async function pushWorkoutNote(messageId: string | null | undefined): Promise<void> {
  if (!messageId) return;
  try {
    const { notifyNewMessage } = await import("@/lib/push/events.functions");
    await notifyNewMessage({ data: { messageId } });
  } catch {
    /* the note is in Messages either way */
  }
}
