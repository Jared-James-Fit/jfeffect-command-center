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

/* ======================= Tracker: every request, any outcome ======================= */

/** Where a sent request ended up. "missed" = never filled before a newer one replaced it. */
export type TrackedState = "open" | "submitted" | "missed";
export type TrackedStatus = "submitted" | "waiting" | "overdue" | "missed";

export type TrackedRequest = OutstandingRequest & {
  state: TrackedState;
  submittedAt: string | null;
  /** messenger_checkins.id for check-ins, nf_submissions.id for native forms. */
  submissionId: string | null;
};

export function trackedStatus(r: Pick<TrackedRequest, "state" | "sentAt">, now = Date.now()): TrackedStatus {
  if (r.state === "submitted") return "submitted";
  if (r.state === "missed") return "missed";
  return requestStatus(r, now);
}

export const TRACKER_TZ = "America/Winnipeg";
const DOW: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Monday (YYYY-MM-DD, coach's time zone) of the week `iso` falls in. */
export function weekOf(iso: string, tz = TRACKER_TZ): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const d = new Date(Date.UTC(+get("year"), +get("month") - 1, +get("day")));
  d.setUTCDate(d.getUTCDate() - (DOW[get("weekday")] ?? 0));
  return d.toISOString().slice(0, 10);
}

/** "Oct 5" for a YYYY-MM-DD week start. */
export function weekLabel(week: string): string {
  return new Date(`${week}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
}

export type WeekSummary = { week: string; sent: number; submitted: number; open: number; overdue: number; missed: number };

export function summarize(rows: TrackedRequest[], now = Date.now()): Omit<WeekSummary, "week"> {
  const s = { sent: rows.length, submitted: 0, open: 0, overdue: 0, missed: 0 };
  for (const r of rows) {
    const st = trackedStatus(r, now);
    if (st === "submitted") s.submitted++;
    else if (st === "missed") s.missed++;
    else {
      s.open++;
      if (st === "overdue") s.overdue++;
    }
  }
  return s;
}

/** One summary per week that had requests, newest week first. */
export function summarizeWeeks(rows: TrackedRequest[], now = Date.now()): WeekSummary[] {
  const by = new Map<string, TrackedRequest[]>();
  for (const r of rows) {
    const w = weekOf(r.sentAt);
    const list = by.get(w) ?? [];
    list.push(r);
    by.set(w, list);
  }
  return Array.from(by, ([week, list]) => ({ week, ...summarize(list, now) })).sort((a, b) => b.week.localeCompare(a.week));
}

const STATUS_ORDER: Record<TrackedStatus, number> = { overdue: 0, waiting: 1, submitted: 2, missed: 3 };

/** What needs action first (overdue, oldest first), then filled (newest first), then missed. */
export function sortTracked(rows: TrackedRequest[], now = Date.now()): TrackedRequest[] {
  return rows.slice().sort((a, b) => {
    const sa = trackedStatus(a, now);
    const sb = trackedStatus(b, now);
    if (sa !== sb) return STATUS_ORDER[sa] - STATUS_ORDER[sb];
    if (sa === "submitted") return (b.submittedAt ?? b.sentAt).localeCompare(a.submittedAt ?? a.sentAt);
    if (sa === "missed") return b.sentAt.localeCompare(a.sentAt);
    return a.sentAt.localeCompare(b.sentAt);
  });
}

export type MatchedFormRequest<M> = {
  message: M;
  formId: string;
  title: string | null;
  state: TrackedState;
  submittedAt: string | null;
  submissionId: string | null;
};

/**
 * Every `form_request` with its outcome. A submission fills the latest request
 * of that client + form sent before it (60s slack for clock skew); a request
 * left unfilled when a newer one went out is "missed", the newest unfilled one
 * is still "open".
 */
export function matchFormRequests<
  M extends { id: string; client_id: string; created_at: string; attachments?: any },
>(
  messages: M[],
  submissions: Array<{ id: string; client_id: string; form_id: string; submitted_at: string | null }>,
): Array<MatchedFormRequest<M>> {
  type Req = { message: M; formId: string; title: string | null; t: number };
  const groups = new Map<string, Req[]>();
  for (const m of messages) {
    const att = (Array.isArray(m.attachments) ? m.attachments : []).find((a: any) => a?.kind === "form_request" && a.form_id);
    if (!att || att.form_id === RETIRED_NUTRITION_REVIEW_FORM_ID) continue;
    const k = `${m.client_id}|${att.form_id}`;
    const list = groups.get(k) ?? [];
    list.push({ message: m, formId: att.form_id, title: att.request_title ?? null, t: new Date(m.created_at).getTime() });
    groups.set(k, list);
  }
  const subsByKey = new Map<string, Array<{ id: string; t: number; at: string }>>();
  for (const s of submissions) {
    if (!s.submitted_at) continue;
    const k = `${s.client_id}|${s.form_id}`;
    const list = subsByKey.get(k) ?? [];
    list.push({ id: s.id, t: new Date(s.submitted_at).getTime(), at: s.submitted_at });
    subsByKey.set(k, list);
  }

  const out: Array<MatchedFormRequest<M>> = [];
  for (const [k, reqs] of groups) {
    reqs.sort((a, b) => a.t - b.t);
    const subs = (subsByKey.get(k) ?? []).sort((a, b) => a.t - b.t);
    reqs.forEach((r, i) => {
      const next = reqs[i + 1];
      const sub = subs.find((s) => s.t >= r.t - 60_000 && (!next || s.t < next.t - 60_000));
      const state: TrackedState = sub ? "submitted" : next ? "missed" : "open";
      out.push({ message: r.message, formId: r.formId, title: r.title, state, submittedAt: sub?.at ?? null, submissionId: sub?.id ?? null });
    });
  }
  return out;
}
