// Per-client status of forms and check-ins for the inbox: which requests I've
// sent that the client hasn't filled in yet, and which they've filled in that
// I haven't reviewed. Pure so it can be tested; the inbox feeds it its queries.

import { OVERDUE_HOURS } from "@/lib/inbox-waiting";

export type CheckinRow = { client_id: string; task_type: string; status: string; created_at: string };
export type SubmissionRow = { client_id: string; form_id: string; submitted_at: string | null };
export type RequestMsg = {
  client_id: string;
  created_at: string;
  attachments?: Array<{ kind?: string | null; form_id?: string | null; request_title?: string | null } | null> | null;
};
export type ToReviewRow = {
  client_id: string;
  kind: "form" | "checkin";
  submitted_at: string | null;
  /** Form id (forms) or check-in task type (check-ins): "latest" is per this. */
  type?: string | null;
};

/** A filled-in check-in older than this stops asking for review (no reviewed flag exists for chat check-ins). */
export const REVIEW_WINDOW_DAYS = 14;
/** Missed requests older than this stop counting against a client. */
export const MISSED_WINDOW_DAYS = 28;

/**
 * Filled-in requests that still need my review. Only the LATEST per client and
 * form type counts (older ones are stale, not a backlog). Forms use their
 * reviewed_at (already filtered upstream). Chat check-ins have no reviewed
 * flag, so one counts until I reply after it, or it's older than
 * REVIEW_WINDOW_DAYS.
 */
export function latestToReview(
  rows: ToReviewRow[],
  lastStaffReplyAt: Map<string, string>,
  now = Date.now(),
): ToReviewRow[] {
  const newest = new Map<string, ToReviewRow>();
  for (const r of rows) {
    if (!r.submitted_at) continue;
    const k = `${r.client_id}|${r.kind}|${r.type ?? ""}`;
    const cur = newest.get(k);
    if (!cur || r.submitted_at > (cur.submitted_at as string)) newest.set(k, r);
  }
  return [...newest.values()].filter((r) => {
    if (r.kind !== "checkin") return true;
    const at = r.submitted_at as string;
    if (now - new Date(at).getTime() > REVIEW_WINDOW_DAYS * 86_400_000) return false;
    const reply = lastStaffReplyAt.get(r.client_id);
    return !(reply && reply >= at);
  });
}

export type PendingRequest = {
  key: string;
  kind: "checkin" | "form";
  title: string;
  since: string;
};

export type ClientRequests = {
  /** Requests I sent that are not filled in yet (newest per check-in type / per form). */
  pending: PendingRequest[];
  /** Filled in by the client, not reviewed by me yet. */
  toReview: number;
  /** Requests that were never answered before a newer one replaced them (recent window). */
  missed: number;
};

const CHECKIN_TITLE: Record<string, string> = {
  weekly_checkin: "Weekly check-in",
};

export function deriveRequests(input: {
  checkins: CheckinRow[];
  submissions: SubmissionRow[];
  messages: RequestMsg[];
  toReview: ToReviewRow[];
  now?: number;
}): Map<string, ClientRequests> {
  const now = input.now ?? Date.now();
  const out = new Map<string, ClientRequests>();
  const get = (id: string) => {
    let r = out.get(id);
    if (!r) out.set(id, (r = { pending: [], toReview: 0, missed: 0 }));
    return r;
  };

  // Check-ins: only the newest of each type counts; an older unanswered one was superseded.
  const newest = new Map<string, CheckinRow>();
  for (const c of input.checkins) {
    const k = `${c.client_id}|${c.task_type}`;
    const cur = newest.get(k);
    if (!cur || c.created_at > cur.created_at) newest.set(k, c);
  }
  // Missed = an unanswered request that a newer one replaced, recently.
  for (const c of input.checkins) {
    if (c.status === "superseded" && now - new Date(c.created_at).getTime() <= MISSED_WINDOW_DAYS * 86_400_000) {
      get(c.client_id).missed += 1;
    }
  }
  for (const c of newest.values()) {
    if (c.status === "pending") {
      get(c.client_id).pending.push({
        key: `checkin:${c.task_type}`,
        kind: "checkin",
        title: CHECKIN_TITLE[c.task_type] ?? "Check-in",
        since: c.created_at,
      });
    }
  }

  // Forms sent in chat: newest request per form; filled once a submission lands at/after it.
  const lastSubmit = new Map<string, number>();
  for (const s of input.submissions) {
    if (!s.submitted_at) continue;
    const k = `${s.client_id}|${s.form_id}`;
    const t = new Date(s.submitted_at).getTime();
    if (t > (lastSubmit.get(k) ?? -Infinity)) lastSubmit.set(k, t);
  }
  const newestForm = new Map<string, { client_id: string; form_id: string; title: string; at: string }>();
  for (const m of input.messages) {
    for (const a of m.attachments ?? []) {
      if (a?.kind !== "form_request" || !a.form_id) continue;
      const k = `${m.client_id}|${a.form_id}`;
      const cur = newestForm.get(k);
      if (!cur || m.created_at > cur.at) {
        newestForm.set(k, { client_id: m.client_id, form_id: a.form_id, title: a.request_title || "Form", at: m.created_at });
      }
    }
  }
  for (const [k, f] of newestForm) {
    const filledAt = lastSubmit.get(k);
    // 60s slack: a submission and its request can be stamped by different clocks.
    if (filledAt !== undefined && filledAt >= new Date(f.at).getTime() - 60_000) continue;
    get(f.client_id).pending.push({ key: `form:${f.form_id}`, kind: "form", title: f.title, since: f.at });
  }

  for (const r of input.toReview) get(r.client_id).toReview += 1;
  for (const r of out.values()) r.pending.sort((a, b) => a.since.localeCompare(b.since));
  return out;
}

export function oldestPending(r: ClientRequests | undefined): string | null {
  return r?.pending[0]?.since ?? null;
}

export type RequestChip = {
  tone: "overdue" | "pending" | "filled";
  /** Short, readable: "Check-in not filled · 2 missed", "Filled · review", "1 missed". */
  text: string;
};

/** The one marker shown on an inbox row. Outstanding requests win over "filled", since they need action from the client. Recently missed ones are appended so a pattern is visible. */
export function requestChip(r: ClientRequests | undefined, now = Date.now()): RequestChip | null {
  if (!r) return null;
  const missed = r.missed > 0 ? `${r.missed} missed` : null;
  if (r.pending.length) {
    const overdue = r.pending.some((p) => now - new Date(p.since).getTime() >= OVERDUE_HOURS * 3_600_000);
    const text =
      r.pending.length === 1 ? `${r.pending[0].title} not filled` : `${r.pending.length} requests not filled`;
    return { tone: overdue ? "overdue" : "pending", text: missed ? `${text} · ${missed}` : text };
  }
  if (r.toReview > 0) {
    const text = r.toReview === 1 ? "Filled · review" : `${r.toReview} filled · review`;
    return { tone: "filled", text: missed ? `${text} · ${missed}` : text };
  }
  if (missed) return { tone: "pending", text: missed };
  return null;
}
