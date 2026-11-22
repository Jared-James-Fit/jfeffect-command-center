/**
 * What must be true before independent coaches can run a business on JF
 * Effect, in the order it has to happen (docs/COACHING_PLATFORM.md and
 * docs/COACH_PLATFORM_BUSINESS_2026-11.md). Shown on the owner's Coach
 * platform page. Registration stays closed in SQL (coach_platform_public()
 * always says so) until every gate before "Pilot" is done; this list is the
 * record of where each one stands, updated in code as each lands, never a
 * switch.
 */

/** built: code and tests exist, nothing applied to production (a migration waits for the owner). */
export type GateState = "done" | "built" | "owner" | "next" | "later";

export type Gate = {
  key: string;
  label: string;
  state: GateState;
  detail: string;
};

export const GATE_WORDS: Record<GateState, string> = {
  done: "Done",
  built: "Built, not applied",
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
      state: "built",
      detail: "20270510090000: one restrictive policy on every client_id table and 23 more (the program tree, nutrition days, form answers, user-keyed coaching tables), read from the live catalog when applied. A no-op until a second business exists. After applying, tenant_fence_report() on production must show nothing unfenced.",
    },
    {
      key: "relationships",
      label: "Client invitations, relationships and seats",
      state: "built",
      detail: "Invite by link (email proven by the login or a 6-digit code), consent kept word for word, pause, end, come back with a new invitation, one record per login, seats counted by the database.",
    },
    {
      key: "seat_billing",
      label: "Seat billing in Stripe test mode",
      state: "built",
      detail: "Graduated price, quantity = paid clients, prorations onto the next invoice, 14-day graces, its own webhook (idempotent, claim given back on failure), nightly reconciliation. Refuses a live key. Needs a Stripe test key and webhook secret to run end to end.",
    },
    {
      key: "ai_allowance",
      label: "AI allowance and cost cap per business",
      state: "owner",
      detail: "Built: credits per feature, a monthly allowance from each paid client's price, a hard spend cap, every call's real cost kept. The numbers are proposals for you to approve.",
    },
    {
      key: "org_scope",
      label: "Staff access scoped by organization",
      state: "next",
      detail: "Workspace teams reach their clients' programs, logs and weigh-ins only (an allow-list). Messages, check-ins, nutrition, forms and the coach's own screens need the same, table by table.",
    },
    {
      key: "server_checks",
      label: "Organization checks on every server path",
      state: "next",
      detail: "Workspace functions check the business first (assertOrgAccess). Definer functions that read clients past RLS (the Clients list, jobs) must leave other businesses out before the pilot.",
    },
    {
      key: "client_portal",
      label: "What a workspace's client sees",
      state: "next",
      detail: "Their coach's program, logs and progress, without JF Effect's coaching screens, Crew or JF jobs (which only read service_tier coaching / self_serve).",
    },
    {
      key: "isolation_suite",
      label: "Isolation tests pass with zero cross-business reads",
      state: "next",
      detail: "Database: 131 checks pass as nine people (supabase/tests/coach-workspaces). Still to cover: storage buckets, signed links, realtime, every server function and Cleo.",
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
