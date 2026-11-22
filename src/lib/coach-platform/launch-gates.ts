/**
 * What must be true before independent coaches can run a business on JF
 * Effect, in the order it has to happen (docs/COACHING_PLATFORM.md and
 * docs/COACH_PLATFORM_BUSINESS_2026-11.md). Shown on the owner's Coach
 * platform page. Registration stays closed in SQL (coach_platform_public()
 * always says so) until every gate before "Pilot" is done; this list is the
 * record of where each one stands, updated in code as each lands, never a
 * switch.
 */

export type GateState = "done" | "owner" | "next" | "later";

export type Gate = {
  key: string;
  label: string;
  state: GateState;
  detail: string;
};

export const GATE_WORDS: Record<GateState, string> = {
  done: "Done",
  owner: "Needs you",
  next: "To build",
  later: "After the pilot",
};

export function launchGates(opts: { pricingPublished: boolean }): Gate[] {
  return [
    {
      key: "foundation",
      label: "Organizations foundation and team access",
      state: "done",
      detail: "JF Effect is an organization; a coach's access follows their record; every access change is recorded.",
    },
    {
      key: "waitlist",
      label: "Early-access page and waitlist",
      state: "done",
      detail: "jfeffect.com/coaches and /coaches/apply. No account, business or charge.",
    },
    {
      key: "pricing_engine",
      label: "Seat pricing worked out one way",
      state: "done",
      detail: "Who counts, the monthly fee, proration previews and the Stripe quantity (seat-pricing.ts).",
    },
    {
      key: "pricing_approved",
      label: "Price approved and shown on the site",
      state: opts.pricingPublished ? "done" : "owner",
      detail: opts.pricingPublished ? "Published from the Pricing tab." : "Review the recommendation in Pricing and publish when you're happy with it.",
    },
    {
      key: "fence",
      label: "Tenant fence on every client table",
      state: "next",
      detail: "One restrictive policy per client-keyed table, generated from the live policies, so no business reads another's clients.",
    },
    {
      key: "org_scope",
      label: "Staff access scoped by organization",
      state: "next",
      detail: "59 tables and 75 functions that trust the bare coach role move to organization membership.",
    },
    {
      key: "server_checks",
      label: "Organization checks on every server path",
      state: "next",
      detail: "Every server function that acts as the server after a role check also checks the organization.",
    },
    {
      key: "relationships",
      label: "Client invitations and relationships",
      state: "next",
      detail: "Invite by link or email, accept with an existing account, end a relationship without losing history.",
    },
    {
      key: "isolation_suite",
      label: "Isolation tests pass with zero cross-business reads",
      state: "next",
      detail: "Two businesses, every table, function, storage bucket, signed link, realtime channel and Cleo question.",
    },
    {
      key: "seat_billing",
      label: "Seat billing in Stripe test mode",
      state: "next",
      detail: "Subscription with paid seats as quantity, consent before the first paid client, webhook and reconciliation.",
    },
    {
      key: "legal",
      label: "Coach agreement, data processing addendum and billing terms reviewed",
      state: "owner",
      detail: "Drafts in docs/legal. A Canadian lawyer reviews them before anything is published.",
    },
    {
      key: "tax",
      label: "Sales tax on the platform fee confirmed",
      state: "owner",
      detail: "GST/HST by the coach's province, Manitoba RST on software since Jan 1 2026, BC PST and Quebec QST thresholds. Your accountant confirms.",
    },
    {
      key: "pilot",
      label: "Pilot with a few approved coaches",
      state: "next",
      detail: "Invited from the waitlist once everything above is done.",
    },
    {
      key: "connect",
      label: "Coaches taking client payments through their own Stripe",
      state: "later",
      detail: "Stripe Connect, its own webhook, the owner's books kept apart. Coaches bill clients their own way until then.",
    },
  ];
}

/** Every gate before the pilot is done: only then may a migration open registration. */
export function readyForPilot(gates: readonly Gate[]): boolean {
  const i = gates.findIndex((g) => g.key === "pilot");
  return gates.slice(0, i).every((g) => g.state === "done");
}
