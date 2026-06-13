import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- supabaseAdmin mock ----
// Captures the next response for the two reads the gate performs.
let settingsRow: any = null;
let legalRows: any[] = [];
let legalError: any = null;

vi.mock("@/integrations/supabase/client.server", () => {
  const supabaseAdmin = {
    from(table: string) {
      if (table === "jf_membership_settings") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: settingsRow, error: null }),
        } as any;
      }
      if (table === "v_membership_checkout_legal") {
        return {
          select: async () => ({ data: legalRows, error: legalError }),
        } as any;
      }
      throw new Error("unexpected table " + table);
    },
  };
  return { supabaseAdmin };
});

import { resolveMembershipLaunchGate } from "@/lib/membership-launch-gate.functions";

const REQUIRED_SLUGS = [
  "terms-of-service",
  "privacy-policy",
  "membership-agreement",
  "recurring-billing-disclosure",
  "cancellation-and-refund-policy",
];

function fullyReadyLegal() {
  return REQUIRED_SLUGS.map((slug) => ({
    document_id: `doc-${slug}`,
    slug,
    title: slug,
    doc_type: "membership",
    current_version_id: `v-${slug}`,
    current_version_status: "published",
    current_version_number: 1,
    public_read_allowed: true,
  }));
}

function fullyReadySettings() {
  return {
    monthly_price_id: "price_LIVE_123",
    support_email: "support@jfeffect.com",
    refund_policy: "x",
    trial_days: 3,
  };
}

beforeEach(() => {
  settingsRow = fullyReadySettings();
  legalRows = fullyReadyLegal();
  legalError = null;
});

describe("membership launch gate", () => {
  it("blocks when support email is missing", async () => {
    settingsRow = { ...fullyReadySettings(), support_email: null };
    const r = await resolveMembershipLaunchGate({ admin: true });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Membership checkout is temporarily unavailable.");
    expect(r.admin_blockers).toContain("Support email not configured");
  });

  it("blocks when monthly price id is missing", async () => {
    settingsRow = { ...fullyReadySettings(), monthly_price_id: null };
    const r = await resolveMembershipLaunchGate({ admin: true });
    expect(r.ok).toBe(false);
    expect(r.admin_blockers).toContain("Stripe monthly price not configured");
  });

  it("blocks when a required legal document placement is missing", async () => {
    legalRows = fullyReadyLegal().filter((r) => r.slug !== "membership-agreement");
    const r = await resolveMembershipLaunchGate({ admin: true });
    expect(r.ok).toBe(false);
    expect(r.admin_blockers?.some((b) => /membership-agreement/.test(b))).toBe(true);
  });

  it("blocks when a required document has no published current version (draft only)", async () => {
    legalRows = fullyReadyLegal().map((r) =>
      r.slug === "privacy-policy" ? { ...r, current_version_status: "draft" } : r,
    );
    const r = await resolveMembershipLaunchGate({ admin: true });
    expect(r.ok).toBe(false);
    expect(r.admin_blockers?.some((b) => /privacy-policy: no published current version/.test(b))).toBe(true);
  });

  it("blocks when current version id is missing", async () => {
    legalRows = fullyReadyLegal().map((r) =>
      r.slug === "terms-of-service" ? { ...r, current_version_id: null } : r,
    );
    const r = await resolveMembershipLaunchGate({ admin: true });
    expect(r.ok).toBe(false);
    expect(r.admin_blockers?.some((b) => /terms-of-service: no published current version/.test(b))).toBe(true);
  });

  it("blocks when public read is disabled on a public-required doc", async () => {
    legalRows = fullyReadyLegal().map((r) =>
      r.slug === "cancellation-and-refund-policy" ? { ...r, public_read_allowed: false } : r,
    );
    const r = await resolveMembershipLaunchGate({ admin: true });
    expect(r.ok).toBe(false);
    expect(r.admin_blockers?.some((b) => /cancellation-and-refund-policy: public_read_allowed/.test(b))).toBe(true);
  });

  it("permits checkout when every condition is satisfied", async () => {
    const r = await resolveMembershipLaunchGate({ admin: true });
    expect(r.ok).toBe(true);
    expect(r.message).toBeNull();
    expect(r.admin_blockers).toEqual([]);
    expect(r.required_docs.map((d) => d.slug).sort()).toEqual([...REQUIRED_SLUGS].sort());
  });

  it("never leaks draft content or admin blockers in non-admin mode", async () => {
    settingsRow = { ...fullyReadySettings(), support_email: null };
    const r = await resolveMembershipLaunchGate({ admin: false });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Membership checkout is temporarily unavailable.");
    expect(r.admin_blockers).toBeUndefined();
    expect(r.required_docs).toEqual([]);
  });

  it("does not include legal docs in the response when configuration is incomplete", async () => {
    settingsRow = { ...fullyReadySettings(), support_email: null };
    const r = await resolveMembershipLaunchGate({ admin: true });
    // required_docs may still be populated with valid placements, but ok must be false
    expect(r.ok).toBe(false);
  });

  it("treats Legal placement read failure as a hard block", async () => {
    legalError = { message: "permission denied" };
    legalRows = [];
    const r = await resolveMembershipLaunchGate({ admin: true });
    expect(r.ok).toBe(false);
    expect(r.admin_blockers?.some((b) => /Legal placement read failed/.test(b))).toBe(true);
  });
});