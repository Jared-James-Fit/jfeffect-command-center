// Admin "Requests" tracker: every form / check-in I've sent that the client
// hasn't filled in yet. Pure helpers so the filtering and status rules are
// testable; the data comes from form-requests.functions.ts.

import { OVERDUE_HOURS } from "@/lib/inbox-waiting";
import { NUTRITION_REQUEST_FORM_ID } from "@/lib/nutrition-ai-prompts";

/** The retired monthly "Nutrition Review" form. Never shown or sent again. */
export const RETIRED_NUTRITION_REVIEW_FORM_ID = "0cbd5e2c-ed47-48ea-93fd-20c341013444";

export type RequestKind = "weekly_checkin" | "nutrition_update" | "form";
export type RequestSource = "checkin" | "form";

export type OutstandingRequest = {
  /** Stable row key. */
  key: string;
  source: RequestSource;
  kind: RequestKind;
  title: string;
  clientId: string;
  clientName: string;
  /** The request message in the client's chat (what delete / re-send act on). */
  messageId: string;
  /** messenger_checkins.id for check-ins, nf form id for forms. */
  requestId: string;
  formId: string | null;
  formKind: "native" | "external" | null;
  externalUrl: string | null;
  sentAt: string;
  /** When the client opened the request message, if they have. */
  readAt: string | null;
};

export type RequestStatus = "overdue" | "waiting";

export const KIND_LABEL: Record<RequestKind, string> = {
  weekly_checkin: "Weekly check-in",
  nutrition_update: "Nutrition update",
  form: "Other form",
};

export function classifyKind(source: RequestSource, formId: string | null): RequestKind {
  if (source === "checkin") return "weekly_checkin";
  return formId === NUTRITION_REQUEST_FORM_ID ? "nutrition_update" : "form";
}

export function requestStatus(r: Pick<OutstandingRequest, "sentAt">, now = Date.now()): RequestStatus {
  return now - new Date(r.sentAt).getTime() >= OVERDUE_HOURS * 3_600_000 ? "overdue" : "waiting";
}

/** "3d", "5h", "20m" since sent. */
export function ageLabel(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export type RequestFilters = {
  kind: RequestKind | "all";
  status: RequestStatus | "all";
  /** Only requests the client hasn't even opened. */
  unopenedOnly: boolean;
  search: string;
};

export const DEFAULT_FILTERS: RequestFilters = { kind: "all", status: "all", unopenedOnly: false, search: "" };

/** Filter + order: most overdue (oldest) first, so the top of the list is what needs action. */
export function filterRequests(rows: OutstandingRequest[], f: RequestFilters, now = Date.now()): OutstandingRequest[] {
  const q = f.search.trim().toLowerCase();
  return rows
    .filter((r) => {
      if (f.kind !== "all" && r.kind !== f.kind) return false;
      if (f.status !== "all" && requestStatus(r, now) !== f.status) return false;
      if (f.unopenedOnly && r.readAt) return false;
      if (q && !r.clientName.toLowerCase().includes(q) && !r.title.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export function countByKind(rows: OutstandingRequest[]): Record<RequestKind | "all", number> {
  const out: Record<RequestKind | "all", number> = { all: rows.length, weekly_checkin: 0, nutrition_update: 0, form: 0 };
  for (const r of rows) out[r.kind] += 1;
  return out;
}

export type RequestActionItem = {
  source: RequestSource;
  messageId: string;
  clientId: string;
  requestId: string;
  formId: string | null;
};

export function toActionItem(r: OutstandingRequest): RequestActionItem {
  return { source: r.source, messageId: r.messageId, clientId: r.clientId, requestId: r.requestId, formId: r.formId };
}

/**
 * Newest unanswered `form_request` per client + form. `messages` must be
 * newest-first. A form counts as filled once a submission lands at/after the
 * request (60s slack: request and submission can be stamped by different clocks).
 */
export function pickUnfilledFormRequests<
  M extends { id: string; client_id: string; created_at: string; attachments?: any },
>(
  messages: M[],
  submissions: Array<{ client_id: string; form_id: string; submitted_at: string | null }>,
): Array<{ message: M; formId: string; title: string | null }> {
  const lastSubmit = new Map<string, number>();
  for (const s of submissions) {
    if (!s.submitted_at) continue;
    const k = `${s.client_id}|${s.form_id}`;
    const t = new Date(s.submitted_at).getTime();
    if (t > (lastSubmit.get(k) ?? -Infinity)) lastSubmit.set(k, t);
  }
  const seen = new Set<string>();
  const out: Array<{ message: M; formId: string; title: string | null }> = [];
  for (const m of messages) {
    const att = (Array.isArray(m.attachments) ? m.attachments : []).find(
      (a: any) => a?.kind === "form_request" && a.form_id,
    );
    if (!att) continue;
    if (att.form_id === RETIRED_NUTRITION_REVIEW_FORM_ID) continue;
    const k = `${m.client_id}|${att.form_id}`;
    if (seen.has(k)) continue; // only the newest request per client + form
    seen.add(k);
    const filledAt = lastSubmit.get(k);
    if (filledAt !== undefined && filledAt >= new Date(m.created_at).getTime() - 60_000) continue;
    out.push({ message: m, formId: att.form_id, title: att.request_title ?? null });
  }
  return out;
}
