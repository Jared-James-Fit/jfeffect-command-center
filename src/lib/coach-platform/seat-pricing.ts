/**
 * JF Effect for coaches: what an independent coaching business would pay JF
 * Effect, worked out one way everywhere (pure, tested in
 * coach-platform-seat-pricing.test.ts). The marketing page's examples, the
 * owner's calculator and the coach's billing summary all read it, and the
 * Stripe seat sync (not built: docs/COACH_PLATFORM_BUSINESS_2026-11.md) will.
 *
 * The rule: a business pays for the coaching clients it can coach this month,
 * less the ones that are free.
 *
 *   monthly fee = max(0, billable clients − free clients) × price per client
 *
 * PROPOSED, not approved (Nov 22 2026): 1 free client, $5 CAD a client a
 * month, no base fee, taxes on top. Nothing charges anyone. The site shows a
 * price only once the owner publishes it (app_settings 'coach_platform',
 * coach_platform_public()), and then it's that setting's numbers, never these.
 *
 * Billable is a relationship, never a person on a list: the client accepted
 * the business's invitation, the relationship is active (not paused, ended,
 * archived or removed), it isn't the coach's own account, and the same person
 * counts once however many records they have. Invitations, imports and free
 * app members with no relationship cost nothing. The free client belongs to
 * the business, not to a person: drop from 2 clients to 1 and the one left is
 * free, whoever it is.
 */

export type SeatPricing = {
  /** Clients a business never pays for. */
  freeClients: number;
  /** Price of each client past the free ones, a month, before tax. */
  perClientCents: number;
  /**
   * An optional lower price from a client number on ("$3 from your 26th
   * client"). Null: one price for every paid client (the brief's formula).
   */
  volume: { fromClient: number; perClientCents: number } | null;
  currency: "CAD";
};

/** The proposal in the brief: one price per client. Never shown to the public by itself. */
export const PROPOSED_PRICING: SeatPricing = { freeClients: 1, perClientCents: 500, volume: null, currency: "CAD" };

/**
 * What the business review recommends (docs/COACH_PLATFORM_BUSINESS_2026-11.md):
 * the same, with $3 a client from the 26th, so a 50- or 100-client coach
 * isn't paying more than the flat plans they'd compare it with. The owner
 * decides; nothing uses it until he publishes a price.
 */
export const RECOMMENDED_PRICING: SeatPricing = {
  freeClients: 1,
  perClientCents: 500,
  volume: { fromClient: 26, perClientCents: 300 },
  currency: "CAD",
};

/** What the owner can set (admin page and SQL both hold these bounds). */
export const PRICING_BOUNDS = {
  freeClients: { min: 0, max: 3 },
  perClientCents: { min: 100, max: 5000 },
  volumeFrom: { min: 2, max: 500 },
} as const;

export function cleanPricing(raw: Partial<SeatPricing> | null | undefined): SeatPricing {
  const free = Math.round(Number(raw?.freeClients ?? PROPOSED_PRICING.freeClients));
  const per = Math.round(Number(raw?.perClientCents ?? PROPOSED_PRICING.perClientCents));
  const freeClients = clamp(Number.isFinite(free) ? free : PROPOSED_PRICING.freeClients, PRICING_BOUNDS.freeClients.min, PRICING_BOUNDS.freeClients.max);
  const perClientCents = clamp(Number.isFinite(per) ? per : PROPOSED_PRICING.perClientCents, PRICING_BOUNDS.perClientCents.min, PRICING_BOUNDS.perClientCents.max);
  let volume: SeatPricing["volume"] = null;
  const v = raw?.volume;
  if (v && Number.isFinite(Number(v.fromClient)) && Number.isFinite(Number(v.perClientCents))) {
    const fromClient = clamp(Math.round(Number(v.fromClient)), Math.max(PRICING_BOUNDS.volumeFrom.min, freeClients + 2), PRICING_BOUNDS.volumeFrom.max);
    const vc = clamp(Math.round(Number(v.perClientCents)), PRICING_BOUNDS.perClientCents.min, perClientCents);
    // a "volume" price that isn't lower is no volume price
    if (vc < perClientCents) volume = { fromClient, perClientCents: vc };
  }
  return { freeClients, perClientCents, volume, currency: "CAD" };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ */
/* Who counts                                                          */
/* ------------------------------------------------------------------ */

export type RelationshipStatus =
  | "invited" // sent, not accepted
  | "expired" // invitation ran out
  | "declined"
  | "active"
  | "paused" // the coach can't coach them right now (no programming, no chat)
  | "ended"
  | "archived"
  | "removed";

/** A coaching relationship between one business and one person. */
export type Relationship = {
  /** The client record in the business. */
  clientId: string;
  /** The person (their login). The dedupe key: one person, one seat. Null = never signed in. */
  personId: string | null;
  status: RelationshipStatus;
  acceptedAt: string | null;
  /** The coach's (or a team member's) own account. */
  isStaffSelf?: boolean;
  /** Marked as a duplicate of another record in the business. */
  duplicateOf?: string | null;
};

export type SeatReason =
  | "billable"
  | "not_accepted"
  | "paused"
  | "ended"
  | "staff_self"
  | "duplicate";

export const SEAT_REASON_WORDS: Record<SeatReason, string> = {
  billable: "Active client",
  not_accepted: "Invitation not accepted",
  paused: "Paused",
  ended: "No longer coached",
  staff_self: "Your own account",
  duplicate: "Duplicate record",
};

/** Why one relationship counts or doesn't (before the one-person-one-seat rule). */
export function seatReason(r: Relationship): SeatReason {
  if (r.isStaffSelf) return "staff_self";
  if (r.duplicateOf) return "duplicate";
  if (r.status === "invited" || r.status === "expired" || r.status === "declined") return "not_accepted";
  if (r.status === "paused") return "paused";
  if (r.status === "ended" || r.status === "archived" || r.status === "removed") return "ended";
  // "active" with no acceptance on file is an import, never a seat
  if (!r.acceptedAt) return "not_accepted";
  return "billable";
}

export type SeatCount = {
  /** The relationships that count, one per person. */
  billable: Relationship[];
  /** Everything else with why, so the billing screen can say it. */
  excluded: Array<{ relationship: Relationship; reason: SeatReason }>;
};

/** The business's billable clients: active, accepted, never staff, one per person. */
export function countSeats(rels: readonly Relationship[]): SeatCount {
  const billable: Relationship[] = [];
  const excluded: SeatCount["excluded"] = [];
  const seen = new Set<string>();
  // the earliest accepted record of a person holds their seat
  const ordered = [...rels].sort((a, b) => String(a.acceptedAt ?? "").localeCompare(String(b.acceptedAt ?? "")) || a.clientId.localeCompare(b.clientId));
  for (const r of ordered) {
    const reason = seatReason(r);
    if (reason !== "billable") {
      excluded.push({ relationship: r, reason });
      continue;
    }
    const who = r.personId ?? `client:${r.clientId}`;
    if (seen.has(who)) {
      excluded.push({ relationship: r, reason: "duplicate" });
      continue;
    }
    seen.add(who);
    billable.push(r);
  }
  return { billable, excluded };
}

/** The definition, as the billing screen and the marketing page say it. */
export const BILLABLE_DEFINITION =
  "A client counts when they've accepted your invitation and you're coaching them now. Invitations, paused, ended and archived clients, your own account and duplicate records never count.";

/* ------------------------------------------------------------------ */
/* What it costs                                                       */
/* ------------------------------------------------------------------ */

export function paidClients(billable: number, pricing: SeatPricing = PROPOSED_PRICING): number {
  const n = Math.max(0, Math.floor(Number(billable) || 0));
  return Math.max(0, n - pricing.freeClients);
}

/** The price of the client in place `k` (1 = the first client). */
export function priceOfClient(k: number, pricing: SeatPricing = PROPOSED_PRICING): number {
  if (k <= pricing.freeClients) return 0;
  if (pricing.volume && k >= pricing.volume.fromClient) return pricing.volume.perClientCents;
  return pricing.perClientCents;
}

export function monthlyFeeCents(billable: number, pricing: SeatPricing = PROPOSED_PRICING): number {
  const n = Math.max(0, Math.floor(Number(billable) || 0));
  const paid = paidClients(n, pricing);
  if (!pricing.volume) return paid * pricing.perClientCents;
  let total = 0;
  for (let k = pricing.freeClients + 1; k <= n; k++) total += priceOfClient(k, pricing);
  return total;
}

/** The Stripe subscription's quantity: the paid clients (the free ones are never a line). */
export const stripeQuantity = paidClients;

/** "$55", "$4.50", "$0". */
export function cad(cents: number): string {
  const c = Math.round(cents);
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = abs % 100 === 0;
  const s = (abs / 100).toLocaleString("en-CA", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return `${neg ? "−" : ""}$${s}`;
}

export type SeatSummary = {
  active: number;
  free: number;
  paid: number;
  monthlyCents: number;
  /** "$55 + tax", "Free". */
  monthlyLine: string;
};

/** The billing screen's four numbers. */
export function seatSummary(billable: number, pricing: SeatPricing = PROPOSED_PRICING): SeatSummary {
  const active = Math.max(0, Math.floor(Number(billable) || 0));
  const paid = paidClients(active, pricing);
  const free = active - paid;
  const monthlyCents = monthlyFeeCents(active, pricing);
  return { active, free, paid, monthlyCents, monthlyLine: monthlyCents ? `${cad(monthlyCents)} + tax` : "Free" };
}

/** "1 client: free", "5 clients: $20 a month". */
export function exampleLine(clients: number, pricing: SeatPricing = PROPOSED_PRICING): string {
  const fee = monthlyFeeCents(clients, pricing);
  const who = `${clients} ${clients === 1 ? "client" : "clients"}`;
  return fee ? `${who}: ${cad(fee)} a month` : `${who}: free`;
}

export const EXAMPLE_SIZES = [1, 5, 10, 20, 50] as const;

/** The one sentence the price is explained in. */
export function pricingSentence(pricing: SeatPricing): string {
  const first =
    pricing.freeClients === 0
      ? ""
      : pricing.freeClients === 1
        ? "Your first client is free. "
        : `Your first ${pricing.freeClients} clients are free. `;
  const volume = pricing.volume ? `, ${cad(pricing.volume.perClientCents)} from your ${ordinal(pricing.volume.fromClient)}` : "";
  return `${first}${cad(pricing.perClientCents)} a month for each client after that${volume}. No base fee.`;
}

export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Stripe's graduated tiers for the subscription's quantity (the paid clients:
 * the free ones are never a line). Up to the volume point at the base price,
 * the rest at the volume price.
 */
export function stripeTiers(pricing: SeatPricing): Array<{ upTo: number | "inf"; unitAmountCents: number }> {
  if (!pricing.volume) return [{ upTo: "inf", unitAmountCents: pricing.perClientCents }];
  const baseSeats = pricing.volume.fromClient - pricing.freeClients - 1;
  return [
    { upTo: baseSeats, unitAmountCents: pricing.perClientCents },
    { upTo: "inf", unitAmountCents: pricing.volume.perClientCents },
  ];
}

/* ------------------------------------------------------------------ */
/* A change in clients                                                 */
/* ------------------------------------------------------------------ */

export type SeatChange = {
  paidBefore: number;
  paidAfter: number;
  monthlyBeforeCents: number;
  monthlyAfterCents: number;
  /** Positive: the monthly total goes up. */
  monthlyDeltaCents: number;
  /** First paid client: a card and recurring-billing consent are needed before it's added. */
  needsPaymentSetup: boolean;
  /** The free tier again: billing stops at the end of the period. */
  backToFree: boolean;
  /**
   * The estimated share of this period for the change, on the next invoice
   * (positive a charge, negative a credit). Never charged on its own: a few
   * dollars charged by itself would lose a large share to card fees.
   */
  prorationCents: number;
  /** What the screen says before the coach confirms. */
  words: string;
};

/** What adding or removing clients does to the bill, before anything is confirmed. */
export function seatChangePreview(opts: {
  before: number;
  after: number;
  pricing?: SeatPricing;
  period?: { start: string | Date; end: string | Date } | null;
  now?: Date;
}): SeatChange {
  const pricing = opts.pricing ?? PROPOSED_PRICING;
  const paidBefore = paidClients(opts.before, pricing);
  const paidAfter = paidClients(opts.after, pricing);
  const monthlyBeforeCents = monthlyFeeCents(opts.before, pricing);
  const monthlyAfterCents = monthlyFeeCents(opts.after, pricing);
  const monthlyDeltaCents = monthlyAfterCents - monthlyBeforeCents;
  const share = periodShareLeft(opts.period ?? null, opts.now ?? new Date());
  const prorationCents = Math.round(monthlyDeltaCents * share);
  const needsPaymentSetup = paidBefore === 0 && paidAfter > 0;
  const backToFree = paidBefore > 0 && paidAfter === 0;

  let words: string;
  if (monthlyDeltaCents === 0) {
    words = paidAfter === 0 ? "This client is free. Nothing changes on your bill." : "Your monthly total stays the same.";
  } else if (monthlyDeltaCents > 0) {
    words = `Your monthly total goes from ${monthlyBeforeCents ? cad(monthlyBeforeCents) : "$0"} to ${cad(monthlyAfterCents)} + tax, billed every month until you remove clients.`;
    if (prorationCents > 0) words += ` About ${cad(prorationCents)} for the rest of this billing period is added to your next invoice. Nothing is charged today.`;
  } else {
    words = backToFree
      ? "You're back on the free tier. Billing stops at the end of this period."
      : `Your monthly total goes from ${cad(monthlyBeforeCents)} to ${cad(monthlyAfterCents)} + tax.`;
    if (prorationCents < 0) words += ` The unused ${cad(-prorationCents)} of this period comes off your next invoice.`;
  }
  return { paidBefore, paidAfter, monthlyBeforeCents, monthlyAfterCents, monthlyDeltaCents, needsPaymentSetup, backToFree, prorationCents, words };
}

/** Share of the billing period still to come (0 to 1). No period yet: nothing to prorate. */
export function periodShareLeft(period: { start: string | Date; end: string | Date } | null, now: Date): number {
  if (!period) return 0;
  const s = new Date(period.start).getTime();
  const e = new Date(period.end).getTime();
  const t = now.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return clamp((e - t) / (e - s), 0, 1);
}

/**
 * The Stripe idempotency key for setting a business's paid quantity. The
 * revision is the business's own seat counter (bumped in the database under
 * its lock on every billable change), so a retry of the same change is one
 * update and two changes are never collapsed into one.
 */
export function seatSyncKey(subscriptionId: string, revision: number, quantity: number): string {
  return `coach-seats:${subscriptionId}:${Math.floor(revision)}:${Math.max(0, Math.floor(quantity))}`;
}

/* ------------------------------------------------------------------ */
/* Unit economics (the owner's calculator)                             */
/* ------------------------------------------------------------------ */

/**
 * What one coached client costs to run, a month, in CAD cents, and the fees
 * on a coach's invoice. Defaults are estimates from list prices and the app's
 * own usage (docs/COACH_PLATFORM_BUSINESS_2026-11.md says where each comes
 * from); the admin page lets the owner change them.
 */
export type CostAssumptions = {
  /** Database, compute and storage for one client's records and media. */
  infraPerClientCents: number;
  /** AI a coach runs for one client (check-in reads, plan drafts, film reads). */
  aiPerClientCents: number;
  /** Video storage and delivery for one client's set videos and film. */
  videoPerClientCents: number;
  /** Support time, spread per client. */
  supportPerClientCents: number;
  /** Fixed monthly cost of a coach account with any clients (their own records, onboarding). */
  perCoachCents: number;
  /** Card processing on the coach's invoice: percent and fixed fee (Stripe Canada, domestic). */
  cardPercent: number;
  cardFixedCents: number;
  /** Stripe Billing (0.7%) and Stripe Tax (0.5%) on the invoice. */
  billingPercent: number;
  /** Manitoba RST JF Effect self-assesses on its own cloud bills (7% since Jan 1 2026). */
  cloudTaxPercent: number;
};

/**
 * Moderate use, in CAD at 1.43 per USD (list prices seen Nov 22 2026, the
 * business doc has each): infra is the database, compute and file storage
 * share; AI is weekly check-in reads on GPT-5 mini plus a monthly nutrition
 * draft and a program draft a quarter on the top models (heavy use of every
 * AI draft is about $2.40 a client); video is ~8 set videos a month stored and
 * watched once.
 */
export const DEFAULT_COSTS: CostAssumptions = {
  infraPerClientCents: 20,
  aiPerClientCents: 100,
  videoPerClientCents: 15,
  supportPerClientCents: 25,
  perCoachCents: 50,
  cardPercent: 2.9,
  cardFixedCents: 30,
  billingPercent: 1.2,
  cloudTaxPercent: 7,
};

export type CoachEconomics = {
  clients: number;
  revenueCents: number;
  costCents: number;
  feesCents: number;
  marginCents: number;
  /** Margin as a share of revenue (null with no revenue). */
  marginPct: number | null;
};

/** One business of a given size, a month. */
export function coachEconomics(clients: number, pricing: SeatPricing = PROPOSED_PRICING, costs: CostAssumptions = DEFAULT_COSTS): CoachEconomics {
  const n = Math.max(0, Math.floor(clients));
  const revenueCents = monthlyFeeCents(n, pricing);
  const cloud = (costs.infraPerClientCents + costs.aiPerClientCents + costs.videoPerClientCents) * (1 + costs.cloudTaxPercent / 100);
  const perClient = cloud + costs.supportPerClientCents;
  const costCents = Math.round(n * perClient + (n > 0 ? costs.perCoachCents : 0));
  const feesCents = revenueCents > 0 ? Math.round(revenueCents * ((costs.cardPercent + costs.billingPercent) / 100) + costs.cardFixedCents) : 0;
  const marginCents = revenueCents - costCents - feesCents;
  return { clients: n, revenueCents, costCents, feesCents, marginCents, marginPct: revenueCents ? Math.round((marginCents / revenueCents) * 1000) / 10 : null };
}

/** The smallest business (in clients) that covers its own costs, or null if none up to 500 does. */
export function breakEvenClients(pricing: SeatPricing = PROPOSED_PRICING, costs: CostAssumptions = DEFAULT_COSTS): number | null {
  for (let n = 1; n <= 500; n++) if (coachEconomics(n, pricing, costs).marginCents >= 0) return n;
  return null;
}

/** The database's settings row (coach_platform_public().pricing / coach_platform_get()) as pricing. */
export function pricingFromRow(row: Record<string, unknown> | null | undefined): SeatPricing | null {
  if (!row) return null;
  const vf = row.volume_from == null ? null : Number(row.volume_from);
  const vc = row.volume_cents == null ? null : Number(row.volume_cents);
  return cleanPricing({
    freeClients: Number(row.free_clients),
    perClientCents: Number(row.per_client_cents),
    volume: vf != null && vc != null ? { fromClient: vf, perClientCents: vc } : null,
  });
}
