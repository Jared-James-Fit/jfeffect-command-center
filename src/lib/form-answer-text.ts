/**
 * A native form answer as plain text, and a submission's answered questions in
 * form order. Pure: shared by the Nutrition Update AI (server) and the coach's
 * chat card, so both read an answer the same way.
 */
import { answerAsText } from "@/lib/form-fields";

export type FormAnswerRow = {
  question_id: string;
  value_text?: string | null;
  value_number?: number | string | null;
  value_json?: unknown;
};

export type FormQuestionRow = {
  id: string;
  label: string;
  order_index?: number | null;
  question_type?: string | null;
};

export function formAnswerText(a: FormAnswerRow | null | undefined): string {
  if (!a) return "";
  if (a.value_text != null && String(a.value_text).trim()) return String(a.value_text);
  const j = a.value_json;
  if (a.value_number != null && String(a.value_number).trim() !== "") {
    const unit = j && typeof j === "object" && !Array.isArray(j) && typeof (j as any).unit === "string" ? (j as any).unit : null;
    return unit ? `${a.value_number} ${unit}` : String(a.value_number);
  }
  // Checkboxes, meets (by their own line), a ranking (in order): the same reading as follow-up questions.
  if (Array.isArray(j)) return answerAsText({ value_json: j });
  // a number box cleared keeps only its unit ({ unit: "lb" }): no answer, never '{"unit":"lb"}'
  if (j && typeof j === "object" && Object.keys(j).every((k) => k === "unit")) return "";
  if (j && typeof j === "object") return JSON.stringify(j);
  return j != null ? String(j) : "";
}

/** Questions the client answered, in the form's order (files and videos left out). */
export function answeredQuestions(
  questions: FormQuestionRow[],
  answers: FormAnswerRow[],
): Array<{ id: string; label: string; value: string }> {
  const byQ = new Map(answers.map((a) => [a.question_id, a]));
  return [...questions]
    .filter((q) => q.question_type !== "file" && q.question_type !== "video" && q.question_type !== "info")
    .sort((a, b) => (a.order_index ?? 9999) - (b.order_index ?? 9999))
    .map((q) => ({ id: q.id, label: q.label, value: formAnswerText(byQ.get(q.id)).trim() }))
    .filter((r) => r.value !== "");
}
