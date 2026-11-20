/**
 * The setup sheet's draft (setup-sheet.tsx): what's being typed is kept apart
 * from what's saved until Done (or "Save changes") writes it, so nothing goes
 * to the server half-typed, an exit with changes can ask first, and a draft an
 * interruption cut short (the app closed, the page reloaded, the card behind
 * remounted) is still there when the sheet opens again. Pure, tested.
 */
import { cleanSettings, setupFields, type EquipmentKind, type ExerciseSetup, type Setting } from "./equipment";

export type SetupDraft = { fields: Setting[]; notes: string; photo: string | null };

/** What the sheet starts from: the saved setup, with the kind's usual settings offered (empty) after it. */
export function draftFromSetup(kind: EquipmentKind | null, setup: Pick<ExerciseSetup, "settings" | "notes" | "photo_path"> | null | undefined): SetupDraft {
  return {
    fields: setupFields(kind, setup?.settings ?? []),
    notes: setup?.notes ?? "",
    photo: setup?.photo_path ?? null,
  };
}

/** The draft as it would be stored: labelled values only, the note trimmed. */
export function savedForm(d: SetupDraft): { settings: Setting[]; notes: string | null; photo: string | null } {
  return { settings: cleanSettings(d.fields), notes: d.notes.trim() || null, photo: d.photo ?? null };
}

/**
 * Whether the draft would save anything different from `base`. An offered
 * setting left empty, a label renamed with no value beside it, or a note with
 * only spaces added changes nothing, so it never asks "Save your changes?".
 */
export function draftChanged(draft: SetupDraft, base: SetupDraft): boolean {
  const a = savedForm(draft);
  const b = savedForm(base);
  if (a.notes !== b.notes || a.photo !== b.photo) return true;
  if (a.settings.length !== b.settings.length) return true;
  return a.settings.some((s, i) => s.label !== b.settings[i].label || s.value !== b.settings[i].value);
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

// ─────────────── the draft kept on the phone ───────────────

const STORE_PREFIX = "jf-setup-draft:v1:";
/** A draft older than this is let go (a whole day: it was abandoned, not interrupted). */
export const DRAFT_KEEP_MS = 24 * 60 * 60_000;

type Stored = { draft: SetupDraft; base: string | null; at: number };

export function draftKey(clientId: string, exerciseId: string, equipmentId: string | null): string {
  return `${STORE_PREFIX}${clientId}:${exerciseId}:${equipmentId ?? "none"}`;
}

function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Keep the draft on the phone (`base`: the saved setup's updated_at it was typed over). */
export function keepDraft(key: string, draft: SetupDraft, base: string | null, now = Date.now()): void {
  try {
    store()?.setItem(key, JSON.stringify({ draft, base, at: now } satisfies Stored));
  } catch {
    /* private mode / full: the draft just isn't kept */
  }
}

export function forgetDraft(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    /* nothing to forget */
  }
}

/**
 * A draft left on the phone, only while it's fresh and was typed over the setup
 * as it's saved now: one typed over an older version (the coach changed it
 * since) is let go rather than saved over the newer one.
 */
export function readKeptDraft(key: string, base: string | null, now = Date.now()): SetupDraft | null {
  let raw: string | null = null;
  try {
    raw = store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
  const kept = parseKept(raw, base, now);
  if (raw && !kept) forgetDraft(key);
  return kept;
}

export function parseKept(raw: string | null, base: string | null, now: number): SetupDraft | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Stored;
    if (!s || typeof s.at !== "number" || now - s.at > DRAFT_KEEP_MS) return null;
    if ((s.base ?? null) !== (base ?? null)) return null;
    const d = s.draft;
    if (!d || !Array.isArray(d.fields) || typeof d.notes !== "string") return null;
    return {
      fields: d.fields.map((f) => ({ label: String(f?.label ?? ""), value: String(f?.value ?? "") })),
      notes: d.notes,
      photo: typeof d.photo === "string" ? d.photo : null,
    };
  } catch {
    return null;
  }
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
