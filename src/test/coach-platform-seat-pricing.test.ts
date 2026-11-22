import { describe, expect, it } from "vitest";
import {
  BILLABLE_DEFINITION,
  DEFAULT_COSTS,
  EXAMPLE_SIZES,
  PROPOSED_PRICING,
  RECOMMENDED_PRICING,
  breakEvenClients,
  ordinal,
  priceOfClient,
  stripeTiers,
  cad,
  cleanPricing,
  coachEconomics,
  countSeats,
  exampleLine,
  monthlyFeeCents,
  paidClients,
  periodShareLeft,
  pricingSentence,
  seatChangePreview,
  seatReason,
  seatSummary,
  seatSyncKey,
  stripeQuantity,
  type Relationship,
} from "@/lib/coach-platform/seat-pricing";
import { CAPABILITIES, can, capabilitiesFor } from "@/lib/coach-platform/capabilities";

const rel = (over: Partial<Relationship> & { clientId: string }): Relationship => ({
  personId: `p-${over.clientId}`,
  status: "active",
  acceptedAt: "2026-11-01T00:00:00Z",
  ...over,
});

describe("the fee is max(0, clients − 1) × $5", () => {
  it("matches the examples in the brief", () => {
    expect(EXAMPLE_SIZES.map((n) => monthlyFeeCents(n))).toEqual([0, 2000, 4500, 9500, 24500]);
    expect(monthlyFeeCents(0)).toBe(0);
    expect(monthlyFeeCents(2)).toBe(500);
    expect(exampleLine(1)).toBe("1 client: free");
    expect(exampleLine(10)).toBe("10 clients: $45 a month");
  });

  it("is the proposal, and the sentence says it in one line", () => {
    expect(PROPOSED_PRICING).toEqual({ freeClients: 1, perClientCents: 500, volume: null, currency: "CAD" });
    expect(pricingSentence(PROPOSED_PRICING)).toBe("Your first client is free. $5 a month for each client after that. No base fee.");
    expect(pricingSentence({ freeClients: 0, perClientCents: 650, volume: null, currency: "CAD" })).toBe("$6.50 a month for each client after that. No base fee.");
  });

  it("never goes negative and ignores junk counts", () => {
    expect(paidClients(-3)).toBe(0);
    expect(paidClients(Number.NaN)).toBe(0);
    expect(paidClients(2.9)).toBe(1);
    expect(stripeQuantity(12)).toBe(11);
  });

  it("the free client belongs to the business: down to one client, it's free", () => {
    expect(seatSummary(2)).toMatchObject({ active: 2, free: 1, paid: 1, monthlyLine: "$5 + tax" });
    expect(seatSummary(1)).toMatchObject({ active: 1, free: 1, paid: 0, monthlyLine: "Free" });
    expect(seatSummary(12)).toMatchObject({ active: 12, free: 1, paid: 11, monthlyCents: 5500, monthlyLine: "$55 + tax" });
  });

  it("owner-set pricing stays inside its bounds", () => {
    expect(cleanPricing({ freeClients: 9, perClientCents: 10 })).toEqual({ freeClients: 3, perClientCents: 100, volume: null, currency: "CAD" });
    // a volume price that isn't lower, or starts inside the free clients, is corrected
    expect(cleanPricing({ freeClients: 1, perClientCents: 500, volume: { fromClient: 10, perClientCents: 600 } }).volume).toBeNull();
    expect(cleanPricing({ freeClients: 1, perClientCents: 500, volume: { fromClient: 10, perClientCents: 50 } }).volume).toEqual({ fromClient: 10, perClientCents: 100 });
    expect(cleanPricing({ freeClients: 1, perClientCents: 500, volume: { fromClient: 10, perClientCents: 500 } }).volume).toBeNull();
    expect(cleanPricing({ freeClients: 2, perClientCents: 500, volume: { fromClient: 1, perClientCents: 300 } }).volume).toEqual({ fromClient: 4, perClientCents: 300 });
    expect(cleanPricing(null)).toEqual(PROPOSED_PRICING);
    expect(cleanPricing({ perClientCents: Number.NaN })).toEqual(PROPOSED_PRICING);
  });
});

describe("the recommended volume step ($3 from the 26th client)", () => {
  it("costs the same up to 25 clients and less past it", () => {
    for (const n of [1, 5, 10, 20, 25]) expect(monthlyFeeCents(n, RECOMMENDED_PRICING)).toBe(monthlyFeeCents(n));
    expect(monthlyFeeCents(26, RECOMMENDED_PRICING)).toBe(24 * 500 + 300);
    expect(monthlyFeeCents(50, RECOMMENDED_PRICING)).toBe(19500);
    expect(monthlyFeeCents(100, RECOMMENDED_PRICING)).toBe(34500);
    expect(priceOfClient(1, RECOMMENDED_PRICING)).toBe(0);
    expect(priceOfClient(25, RECOMMENDED_PRICING)).toBe(500);
    expect(priceOfClient(26, RECOMMENDED_PRICING)).toBe(300);
  });

  it("is still one sentence, and the Stripe tiers bill the same total", () => {
    expect(pricingSentence(RECOMMENDED_PRICING)).toBe("Your first client is free. $5 a month for each client after that, $3 from your 26th. No base fee.");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(12)).toBe("12th");
    const tiers = stripeTiers(RECOMMENDED_PRICING);
    expect(tiers).toEqual([{ upTo: 24, unitAmountCents: 500 }, { upTo: "inf", unitAmountCents: 300 }]);
    for (const n of [2, 25, 26, 50, 137]) {
      const q = stripeQuantity(n, RECOMMENDED_PRICING);
      const billed = Math.min(q, 24) * 500 + Math.max(0, q - 24) * 300;
      expect(billed).toBe(monthlyFeeCents(n, RECOMMENDED_PRICING));
    }
    expect(stripeTiers(PROPOSED_PRICING)).toEqual([{ upTo: "inf", unitAmountCents: 500 }]);
  });
});

describe("who counts as a billable client", () => {
  it("only accepted, active relationships; never invitations, paused, ended, staff or duplicates", () => {
    expect(seatReason(rel({ clientId: "a" }))).toBe("billable");
    expect(seatReason(rel({ clientId: "b", status: "invited", acceptedAt: null }))).toBe("not_accepted");
    expect(seatReason(rel({ clientId: "c", status: "expired", acceptedAt: null }))).toBe("not_accepted");
    expect(seatReason(rel({ clientId: "d", status: "paused" }))).toBe("paused");
    expect(seatReason(rel({ clientId: "e", status: "archived" }))).toBe("ended");
    expect(seatReason(rel({ clientId: "f", status: "removed" }))).toBe("ended");
    expect(seatReason(rel({ clientId: "g", isStaffSelf: true }))).toBe("staff_self");
    expect(seatReason(rel({ clientId: "h", duplicateOf: "a" }))).toBe("duplicate");
    // an import marked active with no acceptance is never a seat
    expect(seatReason(rel({ clientId: "i", acceptedAt: null }))).toBe("not_accepted");
  });

  it("one person is one seat, however many records they have", () => {
    const { billable, excluded } = countSeats([
      rel({ clientId: "a", personId: "same", acceptedAt: "2026-10-01T00:00:00Z" }),
      rel({ clientId: "b", personId: "same", acceptedAt: "2026-11-01T00:00:00Z" }),
      rel({ clientId: "c" }),
      rel({ clientId: "d", status: "invited", acceptedAt: null }),
    ]);
    expect(billable.map((r) => r.clientId)).toEqual(["a", "c"]);
    expect(excluded.map((e) => [e.relationship.clientId, e.reason])).toEqual([
      ["d", "not_accepted"],
      ["b", "duplicate"],
    ]);
  });

  it("is said in plain words", () => {
    expect(BILLABLE_DEFINITION).toMatch(/accepted your invitation/);
    expect(BILLABLE_DEFINITION).toMatch(/never count/);
  });
});

describe("a change in clients is shown before it's confirmed", () => {
  const period = { start: "2026-11-01T00:00:00Z", end: "2026-12-01T00:00:00Z" };

  it("the second client needs payment set up and is prorated onto the next invoice, never charged today", () => {
    const p = seatChangePreview({ before: 1, after: 2, period, now: new Date("2026-11-16T00:00:00Z") });
    expect(p.needsPaymentSetup).toBe(true);
    expect(p.monthlyAfterCents).toBe(500);
    expect(p.prorationCents).toBe(250);
    expect(p.words).toContain("Nothing is charged today.");
    expect(p.words).toContain("from $0 to $5 + tax");
  });

  it("the first client changes nothing", () => {
    const p = seatChangePreview({ before: 0, after: 1, period });
    expect(p.monthlyDeltaCents).toBe(0);
    expect(p.needsPaymentSetup).toBe(false);
    expect(p.words).toBe("This client is free. Nothing changes on your bill.");
  });

  it("removing a client credits the unused part, and back to one is free", () => {
    const down = seatChangePreview({ before: 6, after: 5, period, now: new Date("2026-11-16T00:00:00Z") });
    expect(down.prorationCents).toBe(-250);
    expect(down.words).toContain("comes off your next invoice");
    const free = seatChangePreview({ before: 2, after: 1, period });
    expect(free.backToFree).toBe(true);
    expect(free.words).toContain("back on the free tier");
  });

  it("no period, nothing to prorate; the share is clamped", () => {
    expect(seatChangePreview({ before: 3, after: 4 }).prorationCents).toBe(0);
    expect(periodShareLeft(period, new Date("2027-01-01T00:00:00Z"))).toBe(0);
    expect(periodShareLeft(period, new Date("2026-10-01T00:00:00Z"))).toBe(1);
  });

  it("the seat sync key is stable for a retry and different for the next change", () => {
    expect(seatSyncKey("sub_1", 7, 4)).toBe("coach-seats:sub_1:7:4");
    expect(seatSyncKey("sub_1", 7, 4)).toBe(seatSyncKey("sub_1", 7, 4));
    expect(seatSyncKey("sub_1", 8, 4)).not.toBe(seatSyncKey("sub_1", 7, 4));
  });
});

describe("unit economics", () => {
  it("a free coach costs money and earns nothing; size pays it back", () => {
    const one = coachEconomics(1);
    expect(one.revenueCents).toBe(0);
    expect(one.marginCents).toBeLessThan(0);
    const ten = coachEconomics(10);
    expect(ten.revenueCents).toBe(4500);
    expect(ten.feesCents).toBe(Math.round(4500 * ((DEFAULT_COSTS.cardPercent + DEFAULT_COSTS.billingPercent) / 100) + DEFAULT_COSTS.cardFixedCents));
    // every client past the first earns more than they cost at moderate use
    expect(coachEconomics(20).marginCents).toBeGreaterThan(coachEconomics(10).marginCents);
    expect(ten.marginPct).not.toBeNull();
    expect(breakEvenClients()).not.toBeNull();
  });

  it("the default costs are all set", () => {
    for (const v of Object.values(DEFAULT_COSTS)) expect(Number.isFinite(v)).toBe(true);
  });

  it("money reads in whole dollars when it can", () => {
    expect(cad(5500)).toBe("$55");
    expect(cad(450)).toBe("$4.50");
    expect(cad(-250)).toBe("−$2.50");
  });
});

describe("what an independent coach can never have", () => {
  it("every autonomous capability is the platform owner's alone", () => {
    for (const c of CAPABILITIES.filter((x) => x.autonomous)) {
      expect(c.allowed).toEqual(["platform_owner"]);
    }
    expect(can("independent_coach", "auto_replies")).toBe(false);
    expect(can("independent_coach", "platform_admin")).toBe(false);
    expect(can("independent_coach", "drafts")).toBe(true);
    expect(capabilitiesFor("independent_coach").every((c) => !c.autonomous)).toBe(true);
  });
});

describe("the launch gates", () => {
  it("never read as ready for a pilot while isolation, billing and legal are open", async () => {
    const { launchGates, readyForPilot } = await import("@/lib/coach-platform/launch-gates");
    const gates = launchGates({ pricingPublished: true });
    expect(readyForPilot(gates)).toBe(false);
    expect(gates.find((g) => g.key === "pricing_approved")?.state).toBe("done");
    expect(launchGates({ pricingPublished: false }).find((g) => g.key === "pricing_approved")?.state).toBe("owner");
    // isolation comes before billing, billing before the pilot, client payments after it
    const order = gates.map((g) => g.key);
    expect(order.indexOf("isolation_suite")).toBeLessThan(order.indexOf("pilot"));
    expect(order.indexOf("seat_billing")).toBeLessThan(order.indexOf("pilot"));
    expect(order.indexOf("connect")).toBeGreaterThan(order.indexOf("pilot"));
  });
});
