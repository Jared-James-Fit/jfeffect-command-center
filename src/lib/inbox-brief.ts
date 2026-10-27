// What's waiting on the coach, per client, in one reading: the coach inbox's
// quick filters, the small tags on each row and the client's Brief all come
// from here, so they can never disagree. Pure (the inbox feeds it its own
// queries) and tested.

import { OVERDUE_HOURS } from "@/lib/inbox-waiting";
import type { ClientRequests } from "@/lib/inbox-requests";
import { painLine, type WorkoutNotePain } from "@/lib/workout-notes";

/** Photos, videos and pain notes older than this stop waiting (a stale backlog isn't a to-do). */
export const WAITING_WINDOW_DAYS = 14;

type Att = { type?: string | null; kind?: string | null; pain?: WorkoutNotePain | null; form_id?: string | null; request_title?: string | null } | null | undefined;

export type InboxMsg = {
  id: string;
  client_id: string;
  sender_role: string;
  created_at: string;
  body?: string | null;
  is_internal_note?: boolean | null;
  is_automated?: boolean | null;
  attachments?: Att[] | null;
};

export type MediaWaiting = { messageId: string; at: string; photos: number; videos: number; files: number };
export type PainWaiting = { messageId: string; at: string; line: string };
export type ReviewItem = { kind: "form" | "checkin"; title: string; at: string };
export type RequestItem = { title: string; since: string };

export type ClientSignals = {
  needsReply: { since: string | null; detail: string | null } | null;
  toReview: ReviewItem[];
  overdue: RequestItem[];
  /** Sent, not filled yet, not overdue. */
  pending: RequestItem[];
  missed: number;
  media: MediaWaiting[];
  pain: PainWaiting[];
  sessionRequests: number;
};

const CHECKIN_TITLE: Record<string, string> = { weekly_checkin: "Weekly check-in" };

const isMediaAtt = (a: Att) =>
  !!a && !a.kind && (a.type === "image" || a.type === "video" || a.type === "pdf" || a.type === "file");

/**
 * A real reply from staff: what "answered" means for photos, videos and pain
 * notes sent before it. Automated reminders and internal notes don't count.
 */
const isStaffReply = (m: InboxMsg) => m.sender_role !== "client" && !m.is_internal_note && !m.is_automated;

/**
 * The client's photos / videos / files nobody on staff has reacted to or
 * replied after, in the last WAITING_WINDOW_DAYS. `reactedBy` maps a message
 * to who reacted; the client's own reaction doesn't count.
 */
export function mediaWaitingByClient(
  messages: InboxMsg[],
  reactedBy: Map<string, string[]>,
  clientUserId: Map<string, string | null | undefined>,
  now = Date.now(),
): Map<string, MediaWaiting[]> {
  const out = new Map<string, MediaWaiting[]>();
  const lastReply = lastStaffReplyAt(messages);
  const cutoff = now - WAITING_WINDOW_DAYS * 86_400_000;
  for (const m of messages) {
    if (m.sender_role !== "client" || m.is_internal_note) continue;
    const t = Date.parse(m.created_at);
    if (!(t >= cutoff)) continue;
    const media = (m.attachments ?? []).filter(isMediaAtt);
    if (!media.length) continue;
    const reply = lastReply.get(m.client_id);
    if (reply && reply >= t) continue;
    const own = clientUserId.get(m.client_id);
    if ((reactedBy.get(m.id) ?? []).some((u) => u && u !== own)) continue;
    const item: MediaWaiting = {
      messageId: m.id,
      at: m.created_at,
      photos: media.filter((a) => a!.type === "image").length,
      videos: media.filter((a) => a!.type === "video").length,
      files: media.filter((a) => a!.type === "pdf" || a!.type === "file").length,
    };
    const list = out.get(m.client_id) ?? [];
    list.push(item);
    out.set(m.client_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

/** Pain flagged in a workout note, not replied to since (last WAITING_WINDOW_DAYS). */
export function painWaitingByClient(messages: InboxMsg[], now = Date.now()): Map<string, PainWaiting[]> {
  const out = new Map<string, PainWaiting[]>();
  const lastReply = lastStaffReplyAt(messages);
  const cutoff = now - WAITING_WINDOW_DAYS * 86_400_000;
  for (const m of messages) {
    if (m.sender_role !== "client") continue;
    const t = Date.parse(m.created_at);
    if (!(t >= cutoff)) continue;
    const note = (m.attachments ?? []).find((a) => a?.kind === "workout_note" && a.pain);
    if (!note) continue;
    const reply = lastReply.get(m.client_id);
    if (reply && reply >= t) continue;
    const list = out.get(m.client_id) ?? [];
    list.push({ messageId: m.id, at: m.created_at, line: painLine(note.pain) ?? "Pain" });
    out.set(m.client_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

function lastStaffReplyAt(messages: InboxMsg[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const msg of messages) {
    if (!isStaffReply(msg)) continue;
    const t = Date.parse(msg.created_at);
    if (t > (m.get(msg.client_id) ?? -Infinity)) m.set(msg.client_id, t);
  }
  return m;
}

/** Form titles from the requests I sent in chat ("Nutrition Update Request"), by form id. */
export function formTitles(messages: InboxMsg[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of messages) {
    for (const a of m.attachments ?? []) {
      if (a?.kind === "form_request" && a.form_id && a.request_title && !out.has(a.form_id)) out.set(a.form_id, a.request_title);
    }
  }
  return out;
}

/** Filled in, not reviewed: what each one is and when it came in, newest first. */
export function reviewItemsByClient(
  rows: { client_id: string; kind: "form" | "checkin"; submitted_at: string | null; type?: string | null }[],
  titles: Map<string, string>,
): Map<string, ReviewItem[]> {
  const out = new Map<string, ReviewItem[]>();
  for (const r of rows) {
    if (!r.submitted_at) continue;
    const title = r.kind === "checkin"
      ? CHECKIN_TITLE[r.type ?? ""] ?? "Check-in"
      : (r.type && titles.get(r.type)) || "Form";
    const list = out.get(r.client_id) ?? [];
    list.push({ kind: r.kind, title, at: r.submitted_at });
    out.set(r.client_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

/** Requests not filled: the ones past OVERDUE_HOURS, and the ones still in time. */
export function splitRequests(req: ClientRequests | undefined, now = Date.now()): { overdue: RequestItem[]; pending: RequestItem[] } {
  const overdue: RequestItem[] = [];
  const pending: RequestItem[] = [];
  for (const p of req?.pending ?? []) {
    const item = { title: p.title, since: p.since };
    (now - Date.parse(p.since) >= OVERDUE_HOURS * 3_600_000 ? overdue : pending).push(item);
  }
  return { overdue, pending };
}

/* ------------------------------ filters ------------------------------ */

export type SignalFilter = "To Review" | "Overdue" | "Media" | "Pain" | "Sessions";

export function matchesSignal(s: ClientSignals | undefined, f: SignalFilter): boolean {
  if (!s) return false;
  switch (f) {
    case "To Review": return s.toReview.length > 0;
    case "Overdue": return s.overdue.length > 0;
    case "Media": return s.media.length > 0;
    case "Pain": return s.pain.length > 0;
    case "Sessions": return s.sessionRequests > 0;
  }
}

/* ------------------------------ row tags ------------------------------ */

/** strong = bold, uncoloured (Needs reply: on most rows, so red stays for pain). */
export type SignalTone = "urgent" | "strong" | "warn" | "info" | "muted";
export type SignalTag = { key: "reply" | "pain" | "overdue" | "review" | "media" | "session" | "followup" | "priority"; label: string; tone: SignalTone };

function mediaLabel(items: MediaWaiting[]): string {
  const photos = items.reduce((n, m) => n + m.photos, 0);
  const videos = items.reduce((n, m) => n + m.videos, 0);
  const files = items.reduce((n, m) => n + m.files, 0);
  const parts = [
    videos ? `${videos} video${videos === 1 ? "" : "s"}` : null,
    photos ? `${photos} photo${photos === 1 ? "" : "s"}` : null,
    files ? `${files} file${files === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "Media";
}

/**
 * What a row's one quiet line says, most pressing first (pain before a
 * reply: it's someone's body). The row colours only the first; the Brief
 * has the detail.
 */
export function signalTags(
  s: ClientSignals | undefined,
  extra: { followUp?: boolean; priority?: string | null } = {},
): SignalTag[] {
  const tags: SignalTag[] = [];
  const n = (k: number, one: string, many: string) => (k === 1 ? one : `${k} ${many}`);
  if (s?.pain.length) tags.push({ key: "pain", label: "Pain flagged", tone: "urgent" });
  if (s?.needsReply) tags.push({ key: "reply", label: "Needs reply", tone: "strong" });
  if (s?.overdue.length) tags.push({ key: "overdue", label: n(s.overdue.length, "Form overdue", "forms overdue"), tone: "warn" });
  if (s?.toReview.length) {
    const one = s.toReview[0].kind === "checkin" ? "Check-in to review" : "Form to review";
    tags.push({ key: "review", label: n(s.toReview.length, one, "to review"), tone: "info" });
  }
  if (s?.media.length) tags.push({ key: "media", label: mediaLabel(s.media), tone: "info" });
  if (s?.sessionRequests) tags.push({ key: "session", label: n(s.sessionRequests, "Session request", "session requests"), tone: "info" });
  if (extra.followUp) tags.push({ key: "followup", label: "Follow up", tone: "warn" });
  if (extra.priority && extra.priority !== "Normal") tags.push({ key: "priority", label: extra.priority, tone: "warn" });
  return tags;
}

/** How many things a client has waiting on the coach (the Brief's count). */
export function waitingCount(s: ClientSignals | undefined): number {
  if (!s) return 0;
  return (s.needsReply ? 1 : 0) + s.toReview.length + s.overdue.length + s.media.length + s.pain.length + s.sessionRequests;
}

/* ------------------------------ for the AI ------------------------------ */

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "unknown date");

/**
 * What's waiting, one plain line each, for the Brief's AI read. Dates, not
 * "2h ago": the server caches the read against these lines, so they mustn't
 * change by the minute.
 */
export function briefWaitingLines(s: ClientSignals | undefined, extra: { waitingOnClientSince?: string | null } = {}): string[] {
  if (!s) return [];
  const lines: string[] = [];
  if (s.needsReply) lines.push(`Needs a reply${s.needsReply.detail ? ` (${s.needsReply.detail})` : ""} since ${day(s.needsReply.since)}`);
  for (const p of s.pain) lines.push(`Pain flagged in a workout note on ${day(p.at)}: ${p.line}`);
  for (const r of s.toReview) lines.push(`${r.title} filled in on ${day(r.at)}, not reviewed yet`);
  for (const o of s.overdue) lines.push(`${o.title} sent ${day(o.since)}, still not filled (overdue)`);
  if (s.missed) lines.push(`${s.missed} earlier request${s.missed === 1 ? "" : "s"} never filled in`);
  for (const p of s.pending) lines.push(`${p.title} sent ${day(p.since)}, not filled yet`);
  for (const m of s.media) lines.push(`Sent ${[m.videos && `${m.videos} video(s)`, m.photos && `${m.photos} photo(s)`, m.files && `${m.files} file(s)`].filter(Boolean).join(", ")} on ${day(m.at)}, no reaction or reply yet`);
  if (s.sessionRequests) lines.push(`${s.sessionRequests} session request${s.sessionRequests === 1 ? "" : "s"} waiting for an answer`);
  if (extra.waitingOnClientSince) lines.push(`Jared wrote last, on ${day(extra.waitingOnClientSince)}, and is waiting on the client`);
  return lines.slice(0, 20).map((l) => l.slice(0, 200));
}
