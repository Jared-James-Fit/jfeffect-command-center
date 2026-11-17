/**
 * Checklist questions and readiness (pure, tested).
 *
 * A checklist question (`question_type = "checklist"`) is a list of items the
 * athlete marks Ready, Still need or N/A. Each item carries its own priority
 * (critical / important / optional), an optional line of help and an optional
 * "only show when …" rule, all in `validation.items`, so the coach edits them
 * in the form builder like any other question. An item nobody has marked is
 * "not confirmed", never "missing": only Still need says something is missing.
 *
 * The answer is a list of the items marked, `[{ key, label, state }]`, label
 * kept as it read when marked so history stays readable after a rename.
 *
 * Readiness reads a whole submission by area (`validation.area` on any
 * question; the form's `settings.readiness.areas` names them): a critical or
 * important item marked Still need, or a choice the form flags for the coach
 * (`validation.flag_options`), is an issue; a critical one counts first, and
 * the overall verdict is never "ready" while one is open. No percentage
 * stands in for that: a missing photo ID outweighs any number of packed
 * accessories.
 */
import { conditionsPass, type AnswerLike, type FormRule } from "@/lib/form-logic";

export type ItemState = "ready" | "need" | "na";
export type Priority = "critical" | "important" | "optional";

export const PRIORITIES: Priority[] = ["critical", "important", "optional"];
export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "Critical",
  important: "Important",
  optional: "Optional",
};

export type ChecklistItem = {
  key: string;
  label: string;
  help?: string | null;
  priority: Priority;
  /** Shown only when every rule holds (rules on earlier questions). */
  show_if?: FormRule[] | null;
};

export type ChecklistEntry = { key: string; label: string; state: ItemState };

type QuestionLike = {
  id: string;
  question_type: string;
  label: string;
  required?: boolean | null;
  options?: unknown;
  validation?: Record<string, unknown> | null;
  conditional_logic?: unknown;
  order_index?: number | null;
};

const STATES: ItemState[] = ["ready", "need", "na"];

/** A stable key from an item's words ("Knee sleeves" → "knee-sleeves"). */
export function itemKey(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "item"
  );
}

function asPriority(v: unknown): Priority {
  return v === "critical" || v === "optional" ? v : "important";
}

/** A checklist's items: `validation.items`, else its options (each important). */
export function checklistItems(q: Pick<QuestionLike, "options" | "validation">): ChecklistItem[] {
  const raw = (q.validation as any)?.items;
  const seen = new Set<string>();
  const out: ChecklistItem[] = [];
  const push = (item: ChecklistItem) => {
    let key = item.key;
    let n = 2;
    while (seen.has(key)) key = `${item.key}-${n++}`;
    seen.add(key);
    out.push({ ...item, key });
  };
  if (Array.isArray(raw) && raw.length) {
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const label = typeof r.label === "string" ? r.label.trim() : "";
      if (!label) continue;
      const rules = Array.isArray(r.show_if) ? (r.show_if as FormRule[]).filter((x) => x && typeof x.question_id === "string") : [];
      push({
        key: typeof r.key === "string" && r.key.trim() ? r.key.trim().slice(0, 64) : itemKey(label),
        label: label.slice(0, 160),
        help: typeof r.help === "string" && r.help.trim() ? r.help.trim().slice(0, 240) : null,
        priority: asPriority(r.priority),
        show_if: rules.length ? rules : null,
      });
    }
    return out;
  }
  const opts = Array.isArray(q.options) ? (q.options as unknown[]).filter((o): o is string => typeof o === "string" && !!o.trim()) : [];
  for (const o of opts) push({ key: itemKey(o), label: o.trim(), priority: "important" });
  return out;
}

/** What each item is marked as now (unmarked items are missing from the map). */
export function checklistStates(value: unknown): Map<string, ItemState> {
  const m = new Map<string, ItemState>();
  if (!Array.isArray(value)) return m;
  for (const e of value) {
    if (!e || typeof e !== "object") continue;
    const key = (e as any).key;
    const state = (e as any).state;
    if (typeof key === "string" && STATES.includes(state)) m.set(key, state);
  }
  return m;
}

/** Mark an item (null clears it). Keeps the order items appear in the form. */
export function setItemState(value: unknown, items: ChecklistItem[], item: ChecklistItem, state: ItemState | null): ChecklistEntry[] {
  const states = checklistStates(value);
  if (state) states.set(item.key, state);
  else states.delete(item.key);
  const labels = new Map<string, string>();
  if (Array.isArray(value)) for (const e of value as any[]) if (e && typeof e.key === "string" && typeof e.label === "string") labels.set(e.key, e.label);
  const known = new Set(items.map((i) => i.key));
  const out: ChecklistEntry[] = [];
  for (const i of items) {
    const s = states.get(i.key);
    if (s) out.push({ key: i.key, label: i.label, state: s });
  }
  // Items the coach has since taken out of the form stay in the answer as they were.
  for (const [key, s] of states) if (!known.has(key)) out.push({ key, label: labels.get(key) ?? key, state: s });
  return out;
}

/** Only what carries to a new copy of the form: the items they don't use (N/A). */
export function carriedChecklist(value: unknown): ChecklistEntry[] {
  if (!Array.isArray(value)) return [];
  return (value as any[])
    .filter((e) => e && typeof e.key === "string" && e.state === "na")
    .map((e) => ({ key: e.key, label: typeof e.label === "string" ? e.label : e.key, state: "na" as const }));
}

export function visibleItems(items: ChecklistItem[], answers: Record<string, AnswerLike | undefined>): ChecklistItem[] {
  return items.filter((i) => !i.show_if?.length || conditionsPass({ show_if: i.show_if, match: "all" }, answers));
}

export type ChecklistProgress = {
  total: number;
  marked: number;
  ready: number;
  need: number;
  na: number;
  /** Critical and important items nobody has marked yet. */
  unconfirmed: number;
};

export function checklistProgress(items: ChecklistItem[], value: unknown): ChecklistProgress {
  const states = checklistStates(value);
  const p: ChecklistProgress = { total: items.length, marked: 0, ready: 0, need: 0, na: 0, unconfirmed: 0 };
  for (const i of items) {
    const s = states.get(i.key);
    if (!s) {
      if (i.priority !== "optional") p.unconfirmed++;
      continue;
    }
    p.marked++;
    p[s]++;
  }
  return p;
}

/** A required checklist is done when every critical and important item on screen is marked. */
export function checklistAnswered(items: ChecklistItem[], value: unknown, required: boolean): boolean {
  const states = checklistStates(value);
  if (!required) return items.some((i) => states.has(i.key)) || items.length === 0;
  return items.filter((i) => i.priority !== "optional").every((i) => states.has(i.key));
}

/** A checklist answer as words ("Singlet: Ready · Belt: Still need"). */
export function checklistText(value: unknown, readyLabel = "Ready"): string {
  if (!Array.isArray(value)) return "";
  const word: Record<ItemState, string> = { ready: readyLabel, need: "Still need", na: "N/A" };
  return (value as any[])
    .filter((e) => e && typeof e.label === "string" && STATES.includes(e.state))
    .map((e) => `${e.label}: ${word[e.state as ItemState]}`)
    .join(" · ");
}

export function stateWords(q: Pick<QuestionLike, "validation">): Record<ItemState, string> {
  const ready = (q.validation as any)?.ready_label;
  return {
    ready: typeof ready === "string" && ready.trim() ? ready.trim().slice(0, 16) : "Ready",
    need: "Still need",
    na: "N/A",
  };
}

// ── Readiness ──────────────────────────────────────────────────────────────

export type ReadinessArea = {
  key: string;
  label: string;
  /** What "nothing open" reads as (e.g. "Confirmed"). */
  ok?: string | null;
  /** What an open issue reads as (e.g. "Unresolved"). */
  attention?: string | null;
};

export type Severity = "critical" | "important" | "optional";

export type ReadinessIssue = {
  area: string;
  severity: Severity;
  /** need: marked Still need · flag: an answer the coach should look at · unconfirmed: not marked / not answered yet. */
  kind: "need" | "flag" | "unconfirmed";
  label: string;
  detail?: string | null;
  questionId: string;
  itemKey?: string;
};

export type AreaStatus = {
  key: string;
  label: string;
  /** attention: something open the coach should see · open: not confirmed yet · complete. */
  status: "complete" | "attention" | "open";
  word: string;
  issues: ReadinessIssue[];
};

export type Readiness = {
  /** not_started: nothing answered · attention: a critical or important issue · in_progress: only unconfirmed left · ready. */
  verdict: "not_started" | "attention" | "in_progress" | "ready";
  areas: AreaStatus[];
  issues: ReadinessIssue[];
  critical: number;
  important: number;
  /** Optional items marked Still need (shown, never decisive). */
  optional: number;
  /** Across every checklist on screen. */
  items: ChecklistProgress;
};

export function readinessAreas(settings: unknown): ReadinessArea[] {
  const raw = (settings as any)?.readiness?.areas;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a: any) => a && typeof a.key === "string" && typeof a.label === "string")
    .map((a: any) => ({ key: a.key, label: a.label, ok: typeof a.ok === "string" ? a.ok : null, attention: typeof a.attention === "string" ? a.attention : null }));
}

function flagOptions(q: QuestionLike): string[] {
  const f = (q.validation as any)?.flag_options;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
}

function answerText(a: AnswerLike | undefined): string {
  if (!a) return "";
  if (typeof a.value_text === "string" && a.value_text.trim()) return a.value_text.trim();
  if (a.value_number != null) return String(a.value_number);
  if (Array.isArray(a.value_json)) return (a.value_json as unknown[]).filter((x) => typeof x === "string").join(", ");
  return "";
}

function answered(q: QuestionLike, a: AnswerLike | undefined): boolean {
  if (!a) return false;
  if (Array.isArray(a.value_json)) return a.value_json.length > 0;
  return answerText(a) !== "";
}

const rank: Record<Severity, number> = { critical: 0, important: 1, optional: 2 };

/**
 * A submission's readiness. `visible(q)` is whether the question is on
 * screen for these answers (its own follow-up logic); `extra` adds issues
 * worked out elsewhere (a bodyweight over its class limit).
 */
export function readiness(opts: {
  questions: QuestionLike[];
  answers: Record<string, AnswerLike | undefined>;
  settings?: unknown;
  visible?: (q: QuestionLike) => boolean;
  extra?: ReadinessIssue[];
}): Readiness {
  const { questions, answers } = opts;
  const visible = opts.visible ?? ((q: QuestionLike) => conditionsPass(q.conditional_logic as any, answers));
  const issues: ReadinessIssue[] = [];
  const items: ChecklistProgress = { total: 0, marked: 0, ready: 0, need: 0, na: 0, unconfirmed: 0 };
  let anything = false;
  const areaKeys: string[] = [];

  const ordered = [...questions].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  for (const q of ordered) {
    if (q.question_type === "info" || !visible(q)) continue;
    const area = typeof (q.validation as any)?.area === "string" ? ((q.validation as any).area as string) : null;
    if (area && !areaKeys.includes(area)) areaKeys.push(area);
    const a = answers[q.id];
    if (q.question_type === "checklist") {
      const list = visibleItems(checklistItems(q), answers);
      const p = checklistProgress(list, a?.value_json);
      for (const k of Object.keys(items) as Array<keyof ChecklistProgress>) items[k] += p[k];
      if (p.marked > 0) anything = true;
      if (!area) continue;
      const states = checklistStates(a?.value_json);
      for (const i of list) {
        const s = states.get(i.key);
        if (s === "need") issues.push({ area, severity: i.priority, kind: "need", label: i.label, questionId: q.id, itemKey: i.key });
        else if (!s && i.priority !== "optional") issues.push({ area, severity: i.priority, kind: "unconfirmed", label: i.label, questionId: q.id, itemKey: i.key });
      }
      continue;
    }
    if (answered(q, a)) anything = true;
    if (!area) continue;
    const text = answerText(a);
    const flags = flagOptions(q);
    const level = (q.validation as any)?.flag_level === "critical" ? "critical" : "important";
    if (text && flags.some((f) => text === f || text.split(", ").includes(f))) {
      issues.push({ area, severity: level, kind: "flag", label: q.label, detail: text, questionId: q.id });
    } else if (!answered(q, a) && q.required) {
      issues.push({ area, severity: level, kind: "unconfirmed", label: q.label, questionId: q.id });
    }
  }

  for (const x of opts.extra ?? []) {
    issues.push(x);
    if (!areaKeys.includes(x.area)) areaKeys.push(x.area);
  }

  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.kind === "unconfirmed" ? 1 : 0) - (b.kind === "unconfirmed" ? 1 : 0));

  const named = readinessAreas(opts.settings);
  const order = [...named.map((n) => n.key).filter((k) => areaKeys.includes(k)), ...areaKeys.filter((k) => !named.some((n) => n.key === k))];
  const areas: AreaStatus[] = order.map((key) => {
    const def = named.find((n) => n.key === key);
    const mine = issues.filter((i) => i.area === key);
    const open = mine.filter((i) => i.severity !== "optional");
    const status: AreaStatus["status"] = open.some((i) => i.kind !== "unconfirmed") ? "attention" : open.length ? "open" : "complete";
    const word = status === "complete" ? def?.ok ?? "Complete" : status === "attention" ? def?.attention ?? "Needs attention" : "Not confirmed";
    return { key, label: def?.label ?? key, status, word, issues: mine };
  });

  const active = issues.filter((i) => i.kind !== "unconfirmed");
  const critical = active.filter((i) => i.severity === "critical").length;
  const important = active.filter((i) => i.severity === "important").length;
  const optional = active.filter((i) => i.severity === "optional").length;
  const unconfirmed = issues.some((i) => i.kind === "unconfirmed" && i.severity !== "optional");
  const verdict: Readiness["verdict"] = !anything && !active.length
    ? "not_started"
    : critical + important > 0
      ? "attention"
      : unconfirmed
        ? "in_progress"
        : "ready";
  return { verdict, areas, issues, critical, important, optional, items };
}

/** One short line for a card: "Needs attention · 2 critical", "Ready", "In progress · 18 of 24 checked". */
export function readinessLine(r: Readiness): string {
  if (r.verdict === "not_started") return "Not started";
  if (r.verdict === "ready") return "Ready";
  if (r.verdict === "attention") {
    const parts = [r.critical ? `${r.critical} critical` : null, r.important ? `${r.important} important` : null].filter(Boolean);
    return `Needs attention · ${parts.join(", ")}`;
  }
  return r.items.total ? `In progress · ${r.items.marked} of ${r.items.total} checked` : "In progress";
}
