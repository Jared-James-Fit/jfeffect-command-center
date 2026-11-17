/**
 * "Draft with AI" for a new form (pure, tested): the prompt the model gets
 * and the reader that turns its answer into questions the form builder can
 * hold. Nothing the model says is trusted: types outside the builder's list
 * are dropped, every list is capped, and the result is a draft the coach edits
 * before anyone sees it (never sent, never shared, never active by itself).
 */

export const DRAFT_TYPES = [
  "short_text",
  "long_text",
  "number",
  "single_choice",
  "multi_choice",
  "date",
  "rating",
  "checklist",
  "info",
] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];

export type DraftItem = { key: string; label: string; priority: "critical" | "important" | "optional"; help?: string };
export type DraftQuestion = {
  question_type: DraftType;
  label: string;
  help_text: string | null;
  required: boolean;
  options: string[];
  validation: Record<string, unknown>;
};
export type FormDraft = { title: string; description: string | null; category: string | null; questions: DraftQuestion[] };

export const FORM_DRAFT_SYSTEM = `You write forms for a strength and nutrition coach to send their athletes in an app.
Reply with JSON only, no prose, in this shape:
{"title": string, "description": string (one short sentence), "category": string,
 "questions": [{"type": one of ${DRAFT_TYPES.join(" | ")}, "label": string, "help": string (optional, one line),
   "required": boolean, "options": string[] (single_choice / multi_choice only),
   "unit": string (number only, e.g. "lb"), "items": [{"label": string, "priority": "critical" | "important" | "optional", "help": string}] (checklist only)}]}
Rules:
- Ask only what the coach needs. Short, plain questions a person answers on a phone with one thumb.
- Prefer taps (single_choice, multi_choice, checklist, rating) over typing; at most 4 options each where you can.
- "info" is a section heading (label = the heading). Use one before each group of 3+ related questions.
- A "checklist" is a list of things to confirm as Ready / Still need / N/A (packing lists, preparation steps): critical = they can't go without it, optional = depends on the person.
- Never ask for passwords, payment details or government ID numbers.
- At most 30 questions. Category: one of Client Onboarding, Weekly Check-Ins, Powerlifting & Competitions, Nutrition, Training Feedback, Goal Setting, Assessments, Custom Forms.`;

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";
}

/** The model's answer as a draft, or null when it can't be read. */
export function parseFormDraft(text: string): FormDraft | null {
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let j: any;
  try {
    j = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const title = clip(j?.title, 120);
  if (!title || !Array.isArray(j?.questions)) return null;
  const questions: DraftQuestion[] = [];
  for (const q of j.questions.slice(0, 40)) {
    const type = DRAFT_TYPES.includes(q?.type) ? (q.type as DraftType) : null;
    const label = clip(q?.label, 200);
    if (!type || !label) continue;
    const validation: Record<string, unknown> = {};
    let options: string[] = [];
    if (type === "single_choice" || type === "multi_choice") {
      options = Array.isArray(q.options) ? [...new Set(q.options.map((o: unknown) => clip(o, 100)).filter(Boolean))].slice(0, 20) as string[] : [];
      if (options.length < 2) continue;
    }
    if (type === "number") {
      const unit = clip(q.unit, 12);
      if (unit) validation.unit = unit;
    }
    if (type === "checklist") {
      const seen = new Set<string>();
      const items: DraftItem[] = [];
      for (const it of Array.isArray(q.items) ? q.items.slice(0, 40) : []) {
        const l = clip(it?.label, 160);
        if (!l) continue;
        let key = slug(l);
        let n = 2;
        while (seen.has(key)) key = `${slug(l)}-${n++}`;
        seen.add(key);
        const priority = it?.priority === "critical" || it?.priority === "optional" ? it.priority : "important";
        const help = clip(it?.help, 200);
        items.push({ key, label: l, priority, ...(help ? { help } : {}) });
      }
      if (!items.length) continue;
      validation.items = items;
    }
    questions.push({
      question_type: type,
      label,
      help_text: clip(q.help, 240) || null,
      required: type === "info" ? false : q.required === true,
      options,
      validation,
    });
    if (questions.length >= 30) break;
  }
  if (!questions.some((q) => q.question_type !== "info")) return null;
  return { title, description: clip(j.description, 240) || null, category: clip(j.category, 60) || null, questions };
}
