import type { NfQuestion, NfQuestionType } from "@/lib/native-forms";

export const LIFT_REQUEST_CATEGORY = "Powerlifting & Competitions";
export const LIFT_REQUEST_TEMPLATES = {
  final: { title: "Final Prep Review", items: ["1st heaviest of prep", "2nd heaviest of prep", "3rd heaviest of prep", "Last warm-up"] },
  attempts: { title: "Attempt Selection", items: ["Last warm-up", "Most recent heavy single", "Heaviest successful single", "Opener practice"] },
  technique: { title: "Technique Review", items: ["Heavy lift", "Working set", "Back-off set"] },
  post: { title: "Post-Meet Review", items: ["Last warm-up", "First attempt", "Second attempt", "Third attempt"] },
  custom: { title: "Lift Request", items: [] },
} as const;
export type LiftRequestTemplate = keyof typeof LIFT_REQUEST_TEMPLATES;
export type LiftDraftItem = { id: string; title: string; instructions: string };
export type LiftDraftGroup = { id: string; exercise: string; items: LiftDraftItem[] };
export type LiftRequestDraft = { title: string; instructions: string; groups: LiftDraftGroup[] };
const newId = () => crypto.randomUUID();
export function makeLiftDraft(template: LiftRequestTemplate, id = newId): LiftRequestDraft {
  const preset = LIFT_REQUEST_TEMPLATES[template];
  return {
    title: preset.title, instructions: "",
    groups: ["Squat", "Bench Press", "Deadlift"].map(exercise => ({
      id: id(), exercise, items: preset.items.map(title => ({ id: id(), title, instructions: "" })),
    })),
  };
}
export function liftRequestCount(draft: LiftRequestDraft): number {
  return draft.groups.reduce((sum, group) => sum + group.items.length, 0);
}
export function validateLiftDraft(draft: LiftRequestDraft): string | null {
  const count = liftRequestCount(draft);
  if (!draft.title.trim()) return "Enter a request title.";
  if (!count) return "Add at least one lift.";
  if (count > 36) return "Use a maximum of 36 lifts in one request.";
  if (draft.groups.some(g => g.items.length && (!g.exercise.trim() || g.items.some(i => !i.title.trim())))) return "Give each exercise and lift a title.";
  const ids = draft.groups.flatMap(g => g.items.map(i => i.id));
  if (new Set(ids).size !== ids.length) return "Each lift must have its own identity.";
  return null;
}
type QuestionDraft = Omit<NfQuestion, "id" | "form_id" | "archived_at">;
/** Stable grouping metadata; all fields optional. Use the existing native form records and private media pipeline. */
export function liftRequestQuestions(draft: LiftRequestDraft): QuestionDraft[] {
  const error = validateLiftDraft(draft);
  if (error) throw new Error(error);
  const out: QuestionDraft[] = [];
  for (const group of draft.groups) {
    for (const item of group.items) {
      const prefix = `${group.exercise.trim()} · ${item.title.trim()}`;
      const add = (field: string, type: NfQuestionType, label: string, extra: Record<string, unknown> = {}, help: string | null = null) => {
        out.push({ order_index: out.length, question_type: type, label, help_text: help, required: false, options: [], validation: { ...extra, lift_request: { item_id: item.id, exercise: group.exercise.trim(), title: item.title.trim(), field } }, conditional_logic: {} });
      };
      add("heading", "info", prefix, {}, item.instructions.trim() || null);
      add("video", "video", `${prefix} — Video`);
      add("weight", "number", `${prefix} — Weight`, { units: ["kg", "lb"], min: 0 });
      add("reps", "number", `${prefix} — Reps`, { min: 1 });
      add("rpe", "number", `${prefix} — RPE`, { min: 0, max: 10 });
      add("date", "date", `${prefix} — Date performed`);
      add("notes", "long_text", `${prefix} — Notes`, {}, "Optional. If you don't have the lift, leave it blank or tell your coach here.");
    }
  }
  return out;
}
