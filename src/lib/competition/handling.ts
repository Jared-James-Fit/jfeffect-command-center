/**
 * The Competition Handling service (pure, tested in competition-handling.test.ts):
 * a service on a permanent JF Effect account, never an account of its own.
 * Whatever someone's account is (free, member, coaching client), handling sits
 * beside it: one per competition, with its own status, payment, terms and a
 * temporary access window for whoever handles them. Ending it never changes
 * their account, tier, plan or coach.
 *
 * Status follows what happened (`handlingStatus`):
 *   invited     the link went out, nothing back yet
 *   onboarding  they opened it or started the meet details; terms or details still to do
 *   preparing   details in and terms accepted; the plan isn't ready yet
 *   ready       the gameplan is approved and confirmed, and nothing critical is open
 *   completed   the meet is done (the service finished; their account stays as it is)
 *   cancelled   stopped by the coach
 */

export type HandlingStatus = "invited" | "onboarding" | "preparing" | "ready" | "completed" | "cancelled";
export const HANDLING_STATUSES: HandlingStatus[] = ["invited", "onboarding", "preparing", "ready", "completed", "cancelled"];
export const HANDLING_WORD: Record<HandlingStatus, string> = {
  invited: "Invited",
  onboarding: "Onboarding",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type PaymentState = "not_set" | "waived" | "link" | "paid" | "refunded";
export const PAYMENT_WORD: Record<PaymentState, string> = {
  not_set: "No price set",
  waived: "No charge",
  link: "Payment link out",
  paid: "Paid",
  refunded: "Refunded",
};

export function handlingStatus(h: {
  cancelled_at?: string | null;
  completed_at?: string | null;
  competitionStatus?: string | null;
  invite_opened_at?: string | null;
  infoStarted: boolean;
  infoComplete: boolean;
  termsAccepted: boolean;
  planApproved: boolean;
  athleteConfirmed: boolean;
  openCritical: number;
}): HandlingStatus {
  if (h.cancelled_at || h.competitionStatus === "cancelled") return "cancelled";
  if (h.completed_at || h.competitionStatus === "completed") return "completed";
  if (!h.invite_opened_at && !h.infoStarted && !h.termsAccepted) return "invited";
  if (!h.infoComplete || !h.termsAccepted) return "onboarding";
  if (h.planApproved && h.athleteConfirmed && h.openCritical === 0) return "ready";
  return "preparing";
}

/** How the payment reads from the sale (paid when nothing's owed and something came in). */
export function paymentFromSale(
  stored: PaymentState,
  sale: { amount_paid_cents?: number | null; amount_outstanding_cents?: number | null; amount_refunded_cents?: number | null; payment_status?: string | null } | null,
): PaymentState {
  if (!sale || stored === "waived") return stored;
  const paid = Number(sale.amount_paid_cents ?? 0);
  const refunded = Number(sale.amount_refunded_cents ?? 0);
  if (paid > 0 && refunded >= paid) return "refunded";
  if (paid > 0 && Number(sale.amount_outstanding_cents ?? 0) <= 0) return "paid";
  if (/^paid/i.test(String(sale.payment_status ?? ""))) return "paid";
  return "link";
}

/** The handler's temporary access: from two weeks before the meet (or today) to a week after it. */
export function accessWindow(meetDate: string, today: string): { starts: string; ends: string } {
  const add = (iso: string, d: number) => {
    const x = new Date(`${iso}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + d);
    return x.toISOString().slice(0, 10);
  };
  const twoWeeks = add(meetDate, -14);
  return { starts: today < twoWeeks ? today : twoWeeks, ends: add(meetDate, 7) };
}

/* ------------------------------------------------------------------ */
/* The personalized link                                              */

/** How long an invite works. */
export const HANDLING_INVITE_DAYS = 45;
export const HANDLING_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
export const isHandlingToken = (t: unknown): t is string => typeof t === "string" && HANDLING_TOKEN_RE.test(t);
export const handlingPath = (token: string) => `/h/${token}`;

export type InviteState = "ok" | "expired" | "revoked" | "invalid" | "done";
export function inviteState(
  row: { invite_expires_at?: string | null; invite_revoked_at?: string | null; status?: string | null } | null,
  now: Date = new Date(),
): InviteState {
  if (!row) return "invalid";
  if (row.invite_revoked_at || row.status === "cancelled") return "revoked";
  if (row.status === "completed") return "done";
  if (row.invite_expires_at && new Date(row.invite_expires_at).getTime() <= now.getTime()) return "expired";
  return "ok";
}

/**
 * What the invite page does for whoever opens it:
 *  - continue: they're signed in as this athlete
 *  - sign_in:  the athlete has an account; sign in to it
 *  - set_up:   no account yet: create one (the setup link's flow)
 *  - other:    signed in as someone else; the record was made for this invite, so it can be theirs
 *  - not_yours: signed in as someone else and the invite is for an existing account
 */
export type InviteAccess = "continue" | "sign_in" | "set_up" | "other" | "not_yours";
export function inviteAccess(o: {
  viewerClientId: string | null;
  viewerIsStaff: boolean;
  athleteClientId: string;
  athleteHasLogin: boolean;
  placeholder: boolean;
}): InviteAccess {
  if (o.viewerClientId && o.viewerClientId === o.athleteClientId) return "continue";
  if (o.viewerClientId && !o.viewerIsStaff) return !o.athleteHasLogin && o.placeholder ? "other" : "not_yours";
  return o.athleteHasLogin ? "sign_in" : "set_up";
}

/* ------------------------------------------------------------------ */
/* The terms                                                          */

export const HANDLING_TERMS_VERSION = "1.0";

/** The handling terms the athlete accepts (the exact words are kept with the acceptance). */
export function handlingTerms(o: { handler: string; meetName: string; priceText: string | null }): string {
  return [
    `${o.handler} will handle you at ${o.meetName}: warm-up timing, attempt cards and calls on the day, using the gameplan you both agree.`,
    "Your own coach keeps your training. Nothing about your programming changes, and nothing is shared with your coach unless you say so.",
    "Your attempts and warm-ups are a plan, not a promise of any result. You lift within your own limits and tell your handler about any pain or injury.",
    o.priceText
      ? `The handling fee is ${o.priceText} plus applicable tax, paid before the meet. It covers this competition only and isn't a coaching subscription.`
      : "There's no fee for this handling unless your handler tells you otherwise.",
    "Your meet details are kept on your JF Effect account and used to prepare your plan. You can change them any time before the meet.",
  ].join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Filters                                                            */

export const HANDLING_FILTERS: Array<{ key: HandlingStatus | "active"; label: string }> = [
  { key: "active", label: "Active" },
  { key: "invited", label: "Invited" },
  { key: "onboarding", label: "Onboarding" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export function matchesFilter(status: HandlingStatus, filter: HandlingStatus | "active" | "all"): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status !== "completed" && status !== "cancelled";
  return status === filter;
}

/** "$150" or "$149.99" */
export function priceText(cents: number | null | undefined, currency = "CAD"): string | null {
  if (cents == null) return null;
  const v = cents / 100;
  const s = Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
  return currency && currency !== "CAD" ? `${s} ${currency}` : s;
}

/** The invite's message, ready to text or email (never sent by itself). */
export function inviteMessage(o: { first: string | null; handler: string; meetName: string; url: string }): string {
  const hi = o.first ? `Hi ${o.first}, ` : "Hi, ";
  return `${hi}it's ${o.handler}. Here's your link for ${o.meetName}: tell me your meet details and I'll put your gameplan, warm-ups and timeline together. ${o.url}`;
}
