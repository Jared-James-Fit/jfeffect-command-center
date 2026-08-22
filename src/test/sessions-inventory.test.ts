import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  summarizeSessions,
  packageValue,
  sessionsEntitled,
  sessionsToGrant,
  sessionEventLabel,
  fmtMoneyMinor,
} from "@/lib/sessions-inventory";
import {
  WORKSPACE_CONTAINER_CLASS,
  WORKSPACE_GRID_CLASS,
} from "@/components/workspace/workspace-container";

describe("sessions inventory", () => {
  it("summarizes purchased / used / scheduled / remaining consistently", () => {
    const s = summarizeSessions(
      [{ purchase_id: "p1", granted: 16, used: 3, reserved: 2, remaining: 13 }],
      [{ session_count: 1, event_type: "granted" }],
      2,
    );
    expect(s).toEqual({ purchased: 17, used: 3, scheduled: 2, remaining: 14, available: 12 });
  });

  it("never reports negative remaining or available", () => {
    const s = summarizeSessions([{ purchase_id: "p", granted: 2, used: 2, remaining: 0 }], [], 5);
    expect(s.remaining).toBe(0);
    expect(s.available).toBe(0);
  });

  it("derives list vs paid rate per session for an installment package", () => {
    const v = packageValue({
      sessions_purchased: 16,
      contract_value_cents: 80000,
      amount_paid_cents: 21000,
      currency: "CAD",
    });
    expect(v.listRatePerSessionMinor).toBe(5000);
    expect(v.paidRatePerSessionMinor).toBe(1313);
    expect(v.outstandingMinor).toBe(59000);
    expect(fmtMoneyMinor(v.listRatePerSessionMinor, "CAD")).toContain("50.00");
  });
});

describe("sold product fulfillment", () => {
  it("grants every session on the first payment by default", () => {
    expect(
      sessionsEntitled({ sessionsIncluded: 16, fulfillment: "first_payment", amountPaidMinor: 21000, contractValueMinor: 80000 }),
    ).toBe(16);
  });

  it("releases sessions proportionally for per-installment products", () => {
    expect(
      sessionsEntitled({ sessionsIncluded: 16, fulfillment: "per_installment", amountPaidMinor: 20000, contractValueMinor: 80000 }),
    ).toBe(4);
  });

  it("grants nothing before payment, or when fulfillment is manual", () => {
    expect(sessionsEntitled({ sessionsIncluded: 16, fulfillment: "first_payment", amountPaidMinor: 0 })).toBe(0);
    expect(sessionsEntitled({ sessionsIncluded: 16, fulfillment: "manual", amountPaidMinor: 99999 })).toBe(0);
  });

  it("is idempotent — repeated fulfillment runs never double-grant", () => {
    const entitled = sessionsEntitled({ sessionsIncluded: 16, amountPaidMinor: 20000, contractValueMinor: 80000, fulfillment: "first_payment" });
    expect(sessionsToGrant(entitled, 0)).toBe(16);
    expect(sessionsToGrant(entitled, 16)).toBe(0);
    expect(sessionsToGrant(entitled, 20)).toBe(0);
  });
});

describe("terminology", () => {
  it("never says 'credit' in session event labels", () => {
    const labels = ["granted", "reserved", "released", "used", "adjusted", "expired", "refunded", "transferred_in", "transferred_out"]
      .map((t) => sessionEventLabel(t));
    for (const l of labels) expect(l.toLowerCase()).not.toContain("credit");
    expect(labels.join(" ").toLowerCase()).toContain("session");
  });

  it("keeps the client Sessions panel free of user-facing 'credit' wording", () => {
    const src = fs.readFileSync("src/components/sessions/client-sessions-panel.tsx", "utf8");
    const userFacing = src.match(/>[^<>{}]*[Cc]redits?[^<>{}]*</g) ?? [];
    expect(userFacing).toEqual([]);
  });
});

describe("workspace layout", () => {
  it("centers the workspace and prevents horizontal page overflow", () => {
    expect(WORKSPACE_CONTAINER_CLASS).toContain("mx-auto");
    expect(WORKSPACE_CONTAINER_CLASS).toContain("max-w-7xl");
    expect(WORKSPACE_CONTAINER_CLASS).toContain("min-w-0");
    expect(WORKSPACE_CONTAINER_CLASS).toContain("overflow-x-clip");
    expect(WORKSPACE_CONTAINER_CLASS).toContain("safe-area-inset-left");
  });

  it("uses shrinkable grid tracks so wide cards cannot stretch the page", () => {
    expect(WORKSPACE_GRID_CLASS).toContain("grid-cols-[minmax(0,1fr)]");
    expect(WORKSPACE_GRID_CLASS).toContain("md:grid-cols-[repeat(3,minmax(0,1fr))]");
    expect(WORKSPACE_GRID_CLASS).not.toMatch(/\bmd:grid-cols-3\b/);
  });

  it("applies the canonical container and grid on every client workspace tab", () => {
    const src = fs.readFileSync("src/routes/_authenticated/admin/clients.$id.tsx", "utf8");
    expect(src).toContain("WORKSPACE_CONTAINER_CLASS");
    expect(src).not.toMatch(/className="grid gap-6 md:grid-cols-3"/);
    expect(src).toContain("<ClientSessionsPanel");
    // The duplicated legacy session surfaces are gone.
    expect(src).not.toContain("SessionCreditsPanel");
    expect(src).not.toContain("PtSessionsPanel");
  });
});
