/**
 * Admin dashboard "Needs you" feed + snapshot numbers.
 *
 * Pure: every input comes from a source another screen already trusts, so the dashboard can
 * never disagree with them:
 *   - replies     → staff_inbox_state (same rule as the Messages badge)
 *   - check-ins   → messenger_checkins / nf_submissions still unreviewed
 *   - payments, programs ending, setup, counts → admin_clients_directory (the Clients page)
 *   - pain flags  → coach intel; form checks → lift_videos awaiting review
 */

export type InboxRow = {
  client_id: string;
  archived: boolean | null;
  unread: boolean | null;
  workflow_status: string | null;
  last_inbound_at: string | null;
  last_inbound_kind: string | null;
};

export type FeedClient = {
  id: string;
  full_name: string | null;
  profile_picture_url: string | null;
  account_status: string | null;
  f_payment_issue: boolean;
  f_program_ending: boolean;
  block_end: string | null;
};

export type FeedKind = "pain" | "payment" | "reply" | "checkin" | "lift" | "program" | "setup";

export type FeedAction =
  | { kind: "messages"; clientId: string }
  | { kind: "billing"; clientId: string }
  | { kind: "program"; clientId: string }
  | { kind: "profile"; clientId: string }
  | { kind: "lift"; videoId: string }
  | { kind: "intel" };

export type FeedItem = {
  id: string;
  kind: FeedKind;
  clientId: string;
  name: string;
  avatarUrl: string | null;
  /** One plain line under the name: the message itself, the lift, what's missing. */
  reason: string;
  at: string | null;
  urgent: boolean;
  actionLabel: string;
  action: FeedAction;
  /** Open chat check-in this row can close in one tap. */
  checkinId?: string;
  /** Open pain flag this row can close in one tap. */
  painFlagId?: string;
  /** Other things also waiting for this client (shown as "+N more"). */
  more: number;
};

export const FEED_ORDER: Record<FeedKind, number> = {
  pain: 0, payment: 1, reply: 2, checkin: 3, lift: 4, program: 5, setup: 6,
};

export const FEED_GROUPS: { key: "all" | "messages" | "training" | "business"; label: string; kinds: FeedKind[] }[] = [
  { key: "all", label: "All", kinds: ["pain", "payment", "reply", "checkin", "lift", "program", "setup"] },
  { key: "messages", label: "Messages & check-ins", kinds: ["reply", "checkin"] },
  { key: "training", label: "Training", kinds: ["pain", "lift", "program"] },
  { key: "business", label: "Payments & setup", kinds: ["payment", "setup"] },
];

const INVITE_STATES = new Set(["Invite Not Sent", "Invite Sent", "Invite Expired", "Password Reset Sent"]);

/** Conversations waiting on staff: same rule as the Messages tab badge. */
export function waitingOnMe(inbox: InboxRow[]): InboxRow[] {
  return inbox.filter((r) => !r.archived && (r.workflow_status === "needs_response" || !!r.unread));
}

const TASK_LABEL: Record<string, string> = {
  weekly_checkin: "Weekly check-in",
  nutrition_review: "Nutrition check-in",
};

function snippet(text: string | null | undefined, max = 90): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function shortDate(iso: string | null): string {
  if (!iso) return "soon";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function buildNeedsYou(input: {
  clients: FeedClient[];
  inbox: InboxRow[];
  lastClientMessage: Map<string, string>;
  openCheckins: Array<{ id: string; client_id: string; task_type: string | null; submitted_at: string | null }>;
  openForms: Array<{ id: string; client_id: string; submitted_at: string | null }>;
  liftVideos: Array<{ id: string; client_id: string; exercise?: string | null; created_at: string; is_urgent?: boolean | null }>;
  painFlags: Array<{ id: string; client_id: string; keyword?: string | null; created_at?: string | null }>;
}): FeedItem[] {
  const byId = new Map(input.clients.map((c) => [c.id, c]));
  const base = (c: FeedClient) => ({
    clientId: c.id,
    name: c.full_name?.trim() || "Client",
    avatarUrl: c.profile_picture_url ?? null,
    more: 0,
  });
  const items: FeedItem[] = [];

  for (const f of input.painFlags) {
    const c = byId.get(f.client_id);
    if (!c) continue;
    items.push({
      ...base(c), id: `pain-${f.id}`, kind: "pain", urgent: true,
      reason: `Reported pain${f.keyword ? ` · ${f.keyword}` : ""}`, at: f.created_at ?? null,
      actionLabel: "Review", action: { kind: "intel" }, painFlagId: f.id,
    });
  }

  for (const c of input.clients) {
    if (c.f_payment_issue) {
      items.push({
        ...base(c), id: `pay-${c.id}`, kind: "payment", urgent: true,
        reason: "Payment failed or overdue", at: null,
        actionLabel: "Billing", action: { kind: "billing", clientId: c.id },
      });
    }
  }

  const latestCheckin = new Map<string, (typeof input.openCheckins)[number]>();
  for (const ck of input.openCheckins) {
    const cur = latestCheckin.get(ck.client_id);
    if (!cur || (ck.submitted_at ?? "") > (cur.submitted_at ?? "")) latestCheckin.set(ck.client_id, ck);
  }

  const replied = new Set<string>();
  for (const r of waitingOnMe(input.inbox)) {
    const c = byId.get(r.client_id);
    if (!c) continue;
    replied.add(c.id);
    const ck = latestCheckin.get(c.id);
    const isCheckin = r.last_inbound_kind === "checkin" && !!ck;
    items.push({
      ...base(c), id: `msg-${c.id}`, kind: "reply", urgent: false,
      reason: isCheckin
        ? `Sent their ${(TASK_LABEL[ck!.task_type ?? ""] ?? "check-in").toLowerCase()}`
        : snippet(input.lastClientMessage.get(c.id)) ?? "New message",
      at: r.last_inbound_at,
      actionLabel: "Reply", action: { kind: "messages", clientId: c.id },
      checkinId: ck?.id,
    });
  }

  for (const [clientId, ck] of latestCheckin) {
    const c = byId.get(clientId);
    if (!c || replied.has(clientId)) continue;
    items.push({
      ...base(c), id: `ci-${ck.id}`, kind: "checkin", urgent: false,
      reason: `${TASK_LABEL[ck.task_type ?? ""] ?? "Check-in"} to review`, at: ck.submitted_at,
      actionLabel: "Review", action: { kind: "messages", clientId }, checkinId: ck.id,
    });
  }
  for (const f of input.openForms) {
    const c = byId.get(f.client_id);
    if (!c || replied.has(f.client_id) || latestCheckin.has(f.client_id)) continue;
    items.push({
      ...base(c), id: `form-${f.id}`, kind: "checkin", urgent: false,
      reason: "Form to review", at: f.submitted_at,
      actionLabel: "Review", action: { kind: "messages", clientId: f.client_id },
    });
  }

  for (const v of input.liftVideos) {
    const c = byId.get(v.client_id);
    if (!c) continue;
    items.push({
      ...base(c), id: `lift-${v.id}`, kind: "lift", urgent: !!v.is_urgent,
      reason: `Form check${v.exercise ? ` · ${v.exercise}` : ""}`, at: v.created_at,
      actionLabel: "Watch", action: { kind: "lift", videoId: v.id },
    });
  }

  for (const c of input.clients) {
    if (c.f_program_ending) {
      items.push({
        ...base(c), id: `prog-${c.id}`, kind: "program", urgent: false,
        reason: `Program ends ${shortDate(c.block_end)} · nothing queued next`, at: null,
        actionLabel: "Build", action: { kind: "program", clientId: c.id },
      });
    }
    if (c.account_status && INVITE_STATES.has(c.account_status)) {
      items.push({
        ...base(c), id: `setup-${c.id}`, kind: "setup", urgent: c.account_status === "Invite Expired",
        reason: c.account_status === "Invite Not Sent" ? "Invite not sent yet" : `Hasn't set up their account · ${c.account_status}`,
        at: null, actionLabel: "Open", action: { kind: "profile", clientId: c.id },
      });
    }
  }

  // Most important first; newest first within the same kind.
  items.sort((a, b) =>
    (a.urgent === b.urgent ? 0 : a.urgent ? -1 : 1) ||
    FEED_ORDER[a.kind] - FEED_ORDER[b.kind] ||
    (b.at ?? "").localeCompare(a.at ?? ""));

  // One row per client: their most important item, with a count of the rest.
  const out: FeedItem[] = [];
  const seen = new Map<string, FeedItem>();
  for (const it of items) {
    const first = seen.get(it.clientId);
    if (first) { first.more += 1; continue; }
    const row = { ...it };
    seen.set(it.clientId, row);
    out.push(row);
  }
  return out;
}

export type SnapshotTile = {
  key: "replies" | "checkins" | "payments" | "agreements" | "ending" | "missed";
  label: string;
  value: number;
  hint: string;
  /** Clients-page filter the tile opens (null = Messages). */
  flag: string | null;
  tone: "danger" | "warn" | "info";
};

/** The six numbers worth seeing every morning. Each tile opens the matching filtered list. */
export function buildSnapshot(input: {
  waitingReplies: number;
  counts: Partial<Record<string, number>>;
}): SnapshotTile[] {
  const n = (k: string) => Number(input.counts[k] ?? 0);
  const payIssues = n("payment_issues");
  const noPay = n("no_payment");
  const pending = n("payment_pending");
  return [
    { key: "replies", label: "Replies waiting", value: input.waitingReplies, hint: "Conversations waiting on you", flag: null, tone: "warn" },
    { key: "checkins", label: "Check-ins to review", value: n("needs_review"), hint: "Check-ins and forms nobody has reviewed", flag: "needs_review", tone: "warn" },
    {
      key: "payments", label: "Payments to fix", value: payIssues + noPay + pending,
      hint: [payIssues && `${payIssues} failed`, noPay && `${noPay} not set up`, pending && `${pending} awaiting`].filter(Boolean).join(" · ") || "All set",
      flag: payIssues ? "payment_issues" : noPay ? "no_payment" : pending ? "payment_pending" : "no_payment",
      tone: payIssues ? "danger" : "warn",
    },
    { key: "agreements", label: "Unsigned agreements", value: n("no_contract"), hint: "Coaching agreements not signed", flag: "no_contract", tone: "warn" },
    { key: "ending", label: "Programs ending", value: n("program_ending"), hint: "Programs ending in 14 days with nothing next", flag: "program_ending", tone: "info" },
    { key: "missed", label: "Missed workouts", value: n("missed_workouts"), hint: "2+ missed workouts in 14 days", flag: "missed_workouts", tone: "warn" },
  ];
}
