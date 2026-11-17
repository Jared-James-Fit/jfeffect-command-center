/**
 * Follow-up logic for native forms (pure): "show this when … is …", used by
 * whole questions (`conditional_logic`) and by single checklist items
 * (`validation.items[].show_if`). One reading, so a rule means the same thing
 * on a question and on an item.
 */
import { answerAsText } from "@/lib/form-fields";

export type FormRuleOp = "equals" | "not_equals" | "contains" | "not_contains" | "gt" | "lt" | "is_empty" | "is_not_empty";

export type FormRule = {
  question_id: string;
  op: FormRuleOp;
  value: string | number;
};

export type FormConditions = {
  show_if?: FormRule[] | null;
  hide_if?: FormRule[] | null;
  match?: "all" | "any" | null;
};

export type AnswerLike = {
  value_text?: string | null;
  value_number?: number | null;
  value_json?: unknown;
};

export function evalRule(r: FormRule, answers: Record<string, AnswerLike | undefined>): boolean {
  // Words, a number, or a list (checkboxes, meets, a ranking, a checklist) as text.
  const v = answerAsText(answers[r.question_id]);
  switch (r.op) {
    case "equals": return v === String(r.value);
    case "not_equals": return v !== String(r.value);
    case "contains": return v.toLowerCase().includes(String(r.value).toLowerCase());
    case "not_contains": return !v.toLowerCase().includes(String(r.value).toLowerCase());
    // "185 lb" compares as 185.
    case "gt": return parseFloat(v) > Number(r.value);
    case "lt": return parseFloat(v) < Number(r.value);
    case "is_empty": return v.trim() === "";
    case "is_not_empty": return v.trim() !== "";
    default: return true;
  }
}

/** True when the conditions let it show (no conditions: always). */
export function conditionsPass(cl: FormConditions | null | undefined, answers: Record<string, AnswerLike | undefined>): boolean {
  const c = cl ?? {};
  const match = c.match ?? "all";
  const combine = (rules: FormRule[]) => (match === "all" ? rules.every((r) => evalRule(r, answers)) : rules.some((r) => evalRule(r, answers)));
  const show = c.show_if ?? [];
  const hide = c.hide_if ?? [];
  if (show.length > 0 && !combine(show)) return false;
  if (hide.length > 0 && combine(hide)) return false;
  return true;
}

/**
 * A copied form's follow-up rules pointed at the copy's own questions: every
 * `question_id` in a question's show / hide rules, a checklist item's rules
 * and `options_from`, swapped through `ids` (old id → new id). A copy that
 * kept the old ids would follow the original form's answers, so its
 * follow-ups would never show.
 */
export function remapQuestionRefs<Q extends { conditional_logic?: unknown; validation?: unknown }>(q: Q, ids: Map<string, string>): Q {
  const swap = (id: unknown) => (typeof id === "string" && ids.has(id) ? ids.get(id)! : id);
  const rules = (list: unknown) => (Array.isArray(list) ? list.map((r: any) => (r && typeof r === "object" ? { ...r, question_id: swap(r.question_id) } : r)) : list);
  const cl = (q.conditional_logic ?? {}) as Record<string, unknown>;
  const v = (q.validation ?? {}) as Record<string, unknown>;
  const nextV: Record<string, unknown> = { ...v };
  if (typeof v.options_from === "string") nextV.options_from = swap(v.options_from);
  if (Array.isArray(v.items)) nextV.items = (v.items as any[]).map((it) => (it && typeof it === "object" && Array.isArray(it.show_if) ? { ...it, show_if: rules(it.show_if) } : it));
  return {
    ...q,
    conditional_logic: { ...cl, ...(cl.show_if ? { show_if: rules(cl.show_if) } : {}), ...(cl.hide_if ? { hide_if: rules(cl.hide_if) } : {}) },
    validation: nextV,
  };
}
