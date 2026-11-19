/**
 * A form's responses read the way Google Forms' Summary does (pure, tested):
 * each question once, with how many answered it and what they said. Choices
 * are counted (in the form's own option order, anything else after them),
 * a rating or number gets its average and spread, a checklist its items by
 * state, and anything written is listed with who wrote it. Read from each
 * person's latest response, so a monthly form isn't counted twice for the
 * people who answered every month.
 */
import { formAnswerText, type FormAnswerRow } from "@/lib/form-answer-text";

export type SummaryQuestion = {
  id: string;
  label: string;
  question_type: string;
  order_index?: number | null;
  options?: string[] | null;
  validation?: Record<string, unknown> | null;
};

export type SummaryResponse = { submissionId: string; clientId: string; name: string; at: string; answers: FormAnswerRow[] };

export type ChoiceCount = { label: string; count: number; share: number };

export type QuestionSummary =
  | { kind: "choices"; id: string; label: string; answered: number; multi: boolean; counts: ChoiceCount[] }
  | { kind: "numbers"; id: string; label: string; answered: number; average: number; min: number; max: number; unit: string | null; values: Array<{ name: string; value: number }>; scale: ChoiceCount[] | null }
  | { kind: "checklist"; id: string; label: string; answered: number; items: Array<{ label: string; ready: number; need: number; na: number }> }
  | { kind: "text"; id: string; label: string; answered: number; entries: Array<{ name: string; clientId: string; submissionId: string; at: string; text: string }> };

const CHOICE_TYPES = new Set(["single_choice", "dropdown", "multi_choice"]);
const SKIP = new Set(["file", "video", "info"]);

const round1 = (n: number) => Math.round(n * 10) / 10;

function asList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x : x && typeof x === "object" && typeof (x as any).label === "string" ? (x as any).label : "")).filter(Boolean);
}

export function summarizeQuestion(q: SummaryQuestion, responses: SummaryResponse[]): QuestionSummary | null {
  if (SKIP.has(q.question_type)) return null;
  const rows = responses
    .map((r) => ({ r, a: r.answers.find((a) => a.question_id === q.id) ?? null }))
    .filter((x) => x.a && formAnswerText(x.a).trim() !== "");
  const answered = rows.length;

  if (CHOICE_TYPES.has(q.question_type)) {
    const multi = q.question_type === "multi_choice";
    const tally = new Map<string, number>();
    for (const { a } of rows) {
      const picks = multi ? asList(a!.value_json) : [String(a!.value_text ?? formAnswerText(a)).trim()];
      for (const p of new Set(picks.filter(Boolean))) tally.set(p, (tally.get(p) ?? 0) + 1);
    }
    const own = (q.options ?? []).filter(Boolean);
    const order = [...own, ...[...tally.keys()].filter((k) => !own.includes(k)).sort((a, b) => (tally.get(b) ?? 0) - (tally.get(a) ?? 0) || a.localeCompare(b))];
    return {
      kind: "choices",
      id: q.id,
      label: q.label,
      answered,
      multi,
      // a long option list shows only what was picked; a short one shows every option, zeros too
      counts: order
        .filter((k) => own.length <= 8 || (tally.get(k) ?? 0) > 0)
        .map((label) => ({ label, count: tally.get(label) ?? 0, share: answered ? (tally.get(label) ?? 0) / answered : 0 })),
    };
  }

  if (q.question_type === "number" || q.question_type === "rating") {
    const values = rows
      .map(({ r, a }) => {
        const raw = a!.value_number ?? a!.value_text;
        // a cleared box is no answer, never a 0
        return { name: r.name, value: raw == null || String(raw).trim() === "" ? NaN : Number(raw) };
      })
      .filter((v) => Number.isFinite(v.value));
    if (!values.length) return { kind: "text", id: q.id, label: q.label, answered, entries: textEntries(rows) };
    const nums = values.map((v) => v.value);
    const unitAnswer = rows.find(({ a }) => a!.value_json && typeof a!.value_json === "object" && typeof (a!.value_json as any).unit === "string");
    const unit = (unitAnswer?.a?.value_json as any)?.unit ?? (typeof q.validation?.unit === "string" ? (q.validation.unit as string) : null);
    let scale: ChoiceCount[] | null = null;
    if (q.question_type === "rating") {
      const max = Math.max(10, ...nums.map((n) => Math.round(n)));
      scale = Array.from({ length: max }, (_, i) => {
        const count = nums.filter((n) => Math.round(n) === i + 1).length;
        return { label: String(i + 1), count, share: values.length ? count / values.length : 0 };
      });
    }
    return {
      kind: "numbers",
      id: q.id,
      label: q.label,
      answered: values.length,
      average: round1(nums.reduce((s, n) => s + n, 0) / nums.length),
      min: Math.min(...nums),
      max: Math.max(...nums),
      unit,
      values,
      scale,
    };
  }

  if (q.question_type === "checklist") {
    const items = new Map<string, { label: string; ready: number; need: number; na: number }>();
    for (const { a } of rows) {
      for (const it of Array.isArray(a!.value_json) ? (a!.value_json as any[]) : []) {
        if (!it || typeof it.label !== "string") continue;
        const k = String(it.key ?? it.label);
        const e = items.get(k) ?? { label: it.label, ready: 0, need: 0, na: 0 };
        if (it.state === "ready") e.ready++;
        else if (it.state === "need") e.need++;
        else if (it.state === "na") e.na++;
        items.set(k, e);
      }
    }
    // what's still needed leads
    return { kind: "checklist", id: q.id, label: q.label, answered, items: [...items.values()].sort((a, b) => b.need - a.need) };
  }

  return { kind: "text", id: q.id, label: q.label, answered, entries: textEntries(rows) };
}

function textEntries(rows: Array<{ r: SummaryResponse; a: FormAnswerRow | null }>) {
  return rows
    .map(({ r, a }) => ({ name: r.name, clientId: r.clientId, submissionId: r.submissionId, at: r.at, text: formAnswerText(a).trim() }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Every question's summary in the form's order (headings, files and videos left out). */
export function summarizeForm(questions: SummaryQuestion[], responses: SummaryResponse[]): QuestionSummary[] {
  return [...questions]
    .sort((a, b) => (a.order_index ?? 9999) - (b.order_index ?? 9999))
    .map((q) => summarizeQuestion(q, responses))
    .filter((s): s is QuestionSummary => !!s);
}

/** "62%", whole percents. */
export const pctLabel = (share: number) => `${Math.round(share * 100)}%`;
