/**
 * The setup sheet's draft (setup-sheet.tsx): what's on screen, kept apart from
 * what's saved so the autosave (setup-autosave.ts) knows when there's a change
 * to send, a refetch never writes over what's being typed, and a change that
 * couldn't be sent waits on the phone (setup-outbox.ts). Pure, tested.
 */
import { PHOTOS_MAX, cleanSettings, setupFields, setupPhotos, type EquipmentKind, type ExerciseSetup, type Setting } from "./equipment";

export type SetupDraft = { fields: Setting[]; notes: string; photos: string[] };

type ExerciseLike = { name?: string | null; equipment?: string | null } | null | undefined;

/** What the sheet starts from: the saved setup, with the equipment's and lift's usual settings offered (empty) after it. */
export function draftFromSetup(
  kind: EquipmentKind | null,
  setup: Pick<ExerciseSetup, "settings" | "notes" | "photo_path" | "photo_paths"> | null | undefined,
  exercise?: ExerciseLike,
): SetupDraft {
  return {
    fields: setupFields(kind, setup?.settings ?? [], exercise),
    notes: setup?.notes ?? "",
    photos: setupPhotos(setup),
  };
}

/** The draft as it would be stored: labelled values only, the note trimmed, at most 4 photos. */
export function savedForm(d: SetupDraft): { settings: Setting[]; notes: string | null; photos: string[] } {
  const photos: string[] = [];
  for (const p of d.photos ?? []) if (p && !photos.includes(p) && photos.length < PHOTOS_MAX) photos.push(p);
  return { settings: cleanSettings(d.fields), notes: d.notes.trim() || null, photos };
}

/** The draft's stored form as one string, to tell two drafts apart. */
export function formKey(d: SetupDraft): string {
  return JSON.stringify(savedForm(d));
}

/**
 * Whether the draft would save anything different from `base`. An offered
 * setting left empty, a label renamed with no value beside it, or a note with
 * only spaces added changes nothing, so nothing is sent.
 */
export function draftChanged(draft: SetupDraft, base: SetupDraft): boolean {
  return formKey(draft) !== formKey(base);
}

/**
 * Settings that are a number on any rack, bench or machine (a hole, a notch,
 * a pin, an incline, a speed): they get the number pad. Everything else
 * (an attachment, a grip, a label they made up) gets the full keyboard. Every
 * setting typed into a note so far was a number ("Rack height 33", "Incline 10,
 * Speed 2.5", "Rack 9").
 */
const NUMERIC_LABEL = /\b(j[- ]?hooks?|hooks?|safet(?:y|ies)|rack(?: height)?|height|seat|back ?pad|pad|pins?|notch|hole|incline|decline|speed|level|resistance|pulley|foot ?plate|position|setting|bench|angle)\b/i;

/** A value someone typed with letters in it ("9a", "Low") keeps the full keyboard so it can be edited. */
const NUMBERISH = /^[\d.,\s/-]*$/;

export function settingInputMode(label: string, value: string): "decimal" | "text" {
  if (!NUMERIC_LABEL.test(label.trim())) return "text";
  return NUMBERISH.test(value) ? "decimal" : "text";
}

/**
 * Switching to other equipment while the draft has changes: settings typed
 * while "nothing in particular" was picked go with the pick when it has no
 * setup of its own yet (picking the rack names what they were typing for);
 * otherwise the draft is saved where it was typed first, so one machine's
 * settings never land on another.
 */
export function switchPlan({ dirty, fromId, targetHasSetup }: { dirty: boolean; fromId: string | null; targetHasSetup: boolean }): "switch" | "carry" | "save" {
  if (!dirty) return "switch";
  if (fromId === null && !targetHasSetup) return "carry";
  return "save";
}

/**
 * How far a scroll box must move to show `target` whole, with a little room
 * (0 when it already shows). Used when a field gains focus above the keyboard,
 * so the box scrolls itself and iOS never has to pan the page.
 */
export function revealDelta({ top, bottom, viewTop, viewBottom, margin = 12 }: { top: number; bottom: number; viewTop: number; viewBottom: number; margin?: number }): number {
  if (bottom + margin > viewBottom) return Math.min(bottom + margin - viewBottom, Math.max(0, top - margin - viewTop));
  if (top - margin < viewTop) return top - margin - viewTop;
  return 0;
}
