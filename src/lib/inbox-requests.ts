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
export type ToReviewRow = { client_id: string; kind: "form" | "checkin"; submitted_at: string | null };

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
};

const CHECKIN_TITLE: Record<string, string> = {
  weekly_checkin: "Weekly check-in",
  nutrition_review: "Nutrition review",
};

export function deriveRequests(input: {
  checkins: CheckinRow[];
  submissions: SubmissionRow[];
  messages: RequestMsg[];
  toReview: ToReviewRow[];
}): Map<string, ClientRequests> {
  const out = new Map<string, ClientRequests>();
  const get = (id: string) => {
    let r = out.get(id);
    if (!r) out.set(id, (r = { pending: [], toReview: 0 }));
    return r;
  };

  // Check-ins: only the newest of each type counts; an older unanswered one was superseded.
  const newest = new Map<string, CheckinRow>();
  for (const c of input.checkins) {
    const k = `${c.client_id}|${c.task_type}`;
    const cur = newest.get(k);
    if (!cur || c.created_at > cur.created_at) newest.set(k, c);
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
  /** Short, readable: "Check-in not filled", "2 not filled", "Filled · review". */
  text: string;
};

/** The one marker shown on an inbox row. Outstanding requests win over "filled", since they need action from the client. */
export function requestChip(r: ClientRequests | undefined, now = Date.now()): RequestChip | null {
  if (!r) return null;
  if (r.pending.length) {
    const overdue = r.pending.some((p) => now - new Date(p.since).getTime() >= OVERDUE_HOURS * 3_600_000);
    const text =
      r.pending.length === 1 ? `${r.pending[0].title} not filled` : `${r.pending.length} requests not filled`;
    return { tone: overdue ? "overdue" : "pending", text };
  }
  if (r.toReview > 0) return { tone: "filled", text: r.toReview === 1 ? "Filled · review" : `${r.toReview} filled · review` };
  return null;
}
