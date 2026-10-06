/**
 * Presentation plan for recurring chat forms (Weekly Check-In, Nutrition
 * Review). Pure + synchronous so the thread decides expanded vs compact
 * BEFORE rendering — no flash of big cards that then collapse.
 *
 * Rules, per form type (types are independent):
 * - A form "unit" is one request plus, once answered, its submission message.
 *   The visible message for a completed unit is the submission (the thread
 *   already hides the original request in that case).
 * - Only the newest unit of a type can be expanded:
 *     pending   → expanded for everyone (it's the current action)
 *     completed → expanded for the coach (recap + suggested reply is their
 *                 action); compact "Completed" for the client.
 * - Every older unit is compact. An older unanswered request is "superseded"
 *   (shown as "Not completed", never with a Start CTA).
 *
 * This is presentation state only — timestamps, read receipts, workflow
 * status and answers are untouched.
 */
import type { Message } from "@/lib/messages";

export type FormTaskType = "weekly_checkin" | "nutrition_review";
export type FormUnitState = "pending" | "completed" | "superseded";

export type FormPresentation = {
  mode: "expanded" | "compact";
  state: FormUnitState;
  taskType: FormTaskType;
  submissionId: string;
  /** When the request was sent (falls back to the visible message time). */
  sentAt: string;
  /** When the client opened the request message, if known. */
  readAt: string | null;
  /** When the client submitted, if completed. */
  submittedAt: string | null;
};

type FormAtt = { kind: "checkin_request" | "checkin_submission"; id: string; taskType: FormTaskType };

export function formAttachment(m: Pick<Message, "attachments" | "deleted_at">): FormAtt | null {
  if (m.deleted_at) return null;
  for (const a of m.attachments ?? []) {
    if (
      (a?.kind === "checkin_request" || a?.kind === "checkin_submission") &&
      a.checkin_submission_id &&
      (a.checkin_task_type === "weekly_checkin" || a.checkin_task_type === "nutrition_review")
    ) {
      return { kind: a.kind, id: a.checkin_submission_id, taskType: a.checkin_task_type };
    }
  }
  return null;
}

export function planFormMessages(
  messages: Pick<Message, "id" | "attachments" | "deleted_at" | "created_at" | "read_by_client_at">[],
  role: "admin" | "client",
): Map<string, FormPresentation> {
  const requests = new Map<string, { msgId: string; at: string; readAt: string | null }>();
  const submissions = new Map<string, { msgId: string; at: string }>();
  const units = new Map<string, { taskType: FormTaskType; firstAt: string }>();

  for (const m of messages) {
    const f = formAttachment(m);
    if (!f) continue;
    if (f.kind === "checkin_request") {
      if (!requests.has(f.id)) requests.set(f.id, { msgId: m.id, at: m.created_at, readAt: m.read_by_client_at ?? null });
    } else if (!submissions.has(f.id)) {
      submissions.set(f.id, { msgId: m.id, at: m.created_at });
    }
    const u = units.get(f.id);
    if (!u) units.set(f.id, { taskType: f.taskType, firstAt: m.created_at });
    else if (m.created_at < u.firstAt) u.firstAt = m.created_at;
  }

  // Newest unit per type, ordered by when the request went out.
  const newestByType = new Map<FormTaskType, { id: string; at: string }>();
  for (const [id, u] of units) {
    const at = requests.get(id)?.at ?? u.firstAt;
    const cur = newestByType.get(u.taskType);
    if (!cur || at > cur.at || (at === cur.at && id > cur.id)) newestByType.set(u.taskType, { id, at });
  }

  const plan = new Map<string, FormPresentation>();
  for (const [id, u] of units) {
    const req = requests.get(id);
    const sub = submissions.get(id);
    const isNewest = newestByType.get(u.taskType)?.id === id;
    const state: FormUnitState = sub ? "completed" : isNewest ? "pending" : "superseded";
    const expanded = isNewest && (state === "pending" || role === "admin");
    const base = {
      state,
      taskType: u.taskType,
      submissionId: id,
      sentAt: req?.at ?? u.firstAt,
      readAt: req?.readAt ?? null,
      submittedAt: sub?.at ?? null,
    };
    // Request and submission messages of a unit share one presentation;
    // whichever is visible renders it.
    const p: FormPresentation = { mode: expanded ? "expanded" : "compact", ...base };
    if (req) plan.set(req.msgId, p);
    if (sub) plan.set(sub.msgId, p);
  }
  return plan;
}

export type FormHistoryGroup = {
  taskType: FormTaskType;
  /** Older units of this type, newest first. */
  units: FormPresentation[];
  filled: number;
  /** Requests that were never answered before a newer one replaced them. */
  missed: number;
};

/**
 * Collapse the older (compact) units of each form type into ONE summary so a
 * thread with months of check-ins doesn't become a wall of rows, while missed
 * ones stay countable. Types with a single older unit keep their own row.
 * Presentation only: no message is removed.
 *
 * `orderedMessageIds` is the visible thread order. `leaders` maps the message
 * that renders the summary (the oldest older unit's message) to its group;
 * `hidden` holds the other older units' messages, which render nothing.
 */
export function groupFormHistory(
  plan: Map<string, FormPresentation>,
  orderedMessageIds: string[],
): { leaders: Map<string, FormHistoryGroup>; hidden: Set<string> } {
  const byType = new Map<FormTaskType, { msgId: string; p: FormPresentation }[]>();
  const seen = new Set<string>();
  for (const msgId of orderedMessageIds) {
    const p = plan.get(msgId);
    if (!p || p.mode !== "compact" || seen.has(p.submissionId)) continue;
    seen.add(p.submissionId);
    const list = byType.get(p.taskType) ?? [];
    list.push({ msgId, p });
    byType.set(p.taskType, list);
  }

  const leaders = new Map<string, FormHistoryGroup>();
  const hidden = new Set<string>();
  for (const [taskType, list] of byType) {
    if (list.length < 2) continue;
    leaders.set(list[0].msgId, {
      taskType,
      units: list.map((x) => x.p).reverse(),
      filled: list.filter((x) => x.p.state === "completed").length,
      missed: list.filter((x) => x.p.state === "superseded").length,
    });
    for (const x of list.slice(1)) hidden.add(x.msgId);
  }
  return { leaders, hidden };
}
