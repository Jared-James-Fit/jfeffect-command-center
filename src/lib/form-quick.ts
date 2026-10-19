/**
 * Quick answers on a form question (pure, tested): one-tap chips above a
 * typed answer, a sanity range on numbers, and how a question's choices lay
 * out as buttons. The coach sets them per question in the form builder
 * (`nf_questions.validation`: `quick`, `quick_exclusive`, `min`, `max`,
 * `unit`); the answer is still the plain text / number it always was.
 */

type WithValidation = { validation?: Record<string, unknown> | null };

const strings = (v: unknown, max = 12): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => (typeof x === "string" || typeof x === "number" ? String(x).trim() : "")).filter(Boolean))].slice(0, max)
    : [];

/** The one-tap answers shown above a text or number box. */
export function quickAnswers(q: WithValidation): string[] {
  return strings(q.validation?.quick);
}

/** Quick answers that stand alone ("None", "That's everything"): picking one clears the rest. */
export function quickExclusive(q: WithValidation): string[] {
  return strings(q.validation?.quick_exclusive);
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const items = (text: string) =>
  text
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Whether a quick answer is in the typed answer. */
export function quickPicked(text: unknown, chip: string): boolean {
  return typeof text === "string" && items(text).some((i) => same(i, chip));
}

/**
 * Tap a quick answer: in the answer it comes out, else it goes on the end
 * (", " between). A stand-alone one replaces everything; any other takes the
 * stand-alone ones out. What they typed themselves stays.
 */
export function toggleQuick(text: unknown, chip: string, exclusive: string[] = []): string {
  const now = typeof text === "string" ? items(text) : [];
  if (now.some((i) => same(i, chip))) return now.filter((i) => !same(i, chip)).join(", ");
  if (exclusive.some((x) => same(x, chip))) return chip;
  return [...now.filter((i) => !exclusive.some((x) => same(x, i))), chip].join(", ");
}

/** A number's sanity range and unit, when the coach set one. */
export function numberRange(q: WithValidation): { min: number | null; max: number | null; unit: string | null } {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const unit = typeof q.validation?.unit === "string" && q.validation.unit.trim() ? q.validation.unit.trim() : null;
  return { min: n(q.validation?.min), max: n(q.validation?.max), unit };
}

/** What's wrong with a number answer (outside the range, or not a number), or null. */
export function numberIssue(q: WithValidation, value: unknown): string | null {
  if (value === "" || value == null) return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return "Numbers only";
  const { min, max, unit } = numberRange(q);
  const u = unit ? ` ${unit}` : "";
  if (min != null && v < min) return `That looks low. It should be at least ${min.toLocaleString()}${u}`;
  if (max != null && v > max) return `That looks high. It should be ${max.toLocaleString()}${u} or less`;
  return null;
}

/** A quick number's label: "10,000" for 10000. */
export function quickNumberLabel(chip: string): string {
  const v = Number(chip);
  return Number.isFinite(v) && Math.abs(v) >= 1000 ? v.toLocaleString() : chip;
}

/**
 * How a question's choices sit as buttons: a single "Yes, I agree" is one
 * big tick; short ones (3 / 4 / 5 / 6, Male / Female) share a row; the rest
 * are full-width rows that fit a thumb.
 */
export function choiceLayout(options: string[]): "agree" | "row" | "list" {
  if (options.length === 1) return "agree";
  if (options.length <= 4 && options.every((o) => o.length <= 12)) return "row";
  return "list";
}

/** How much of the form is done: the required questions on screen that have an answer. */
export function formProgress(required: { answered: boolean }[]): { done: number; total: number } {
  return { done: required.filter((r) => r.answered).length, total: required.length };
}
