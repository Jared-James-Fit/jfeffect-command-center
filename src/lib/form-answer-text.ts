/**
 * A native form answer as plain text, and a submission's answered questions in
 * form order. Pure: shared by the Nutrition Update AI (server) and the coach's
 * chat card, so both read an answer the same way.
 */

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
  if (a.value_number != null && String(a.value_number).trim() !== "") return String(a.value_number);
  const j = a.value_json;
  if (Array.isArray(j)) {
    return j
      .map((x) =>
        typeof x === "string"
          ? x
          : ((x as { name?: string; label?: string })?.name ??
            (x as { label?: string })?.label ??
            ""),
      )
      .filter(Boolean)
      .join(", ");
  }
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
    .filter((q) => q.question_type !== "file" && q.question_type !== "video")
    .sort((a, b) => (a.order_index ?? 9999) - (b.order_index ?? 9999))
    .map((q) => ({ id: q.id, label: q.label, value: formAnswerText(byQ.get(q.id)).trim() }))
    .filter((r) => r.value !== "");
}
