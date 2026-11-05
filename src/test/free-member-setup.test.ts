import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FREE_SETUP_STEPS,
  FULL_SETUP_STEPS,
  isFreeAccount,
  setupMissing,
  setupStepsFor,
  setupStillOpen,
} from "@/lib/member-setup-steps";

const SQL = readFileSync("supabase/migrations/20270129120000_free_member_setup.sql", "utf8");
const training = {
  goals_tags: ["strength"],
  experience_level: "beginner",
  committed_training_days: ["Monday", "Thursday"],
};

describe("a free account's setup is its training, nothing else", () => {
  it("free = 'Free' with no Stripe subscription", () => {
    expect(isFreeAccount({ subscription_status: "Free" })).toBe(true);
    expect(isFreeAccount({ subscription_status: "free", stripe_subscription_id: null })).toBe(true);
    expect(isFreeAccount({ subscription_status: "Free", stripe_subscription_id: "sub_123" })).toBe(
      false,
    );
    expect(isFreeAccount({ subscription_status: "Active" })).toBe(false);
    expect(isFreeAccount(null)).toBe(false);
  });

  it("a free member is asked two steps; a paid member all five", () => {
    expect(setupStepsFor({ subscription_status: "Free" })).toEqual(FREE_SETUP_STEPS);
    expect(FREE_SETUP_STEPS).toEqual(["goals", "schedule"]);
    expect(setupStepsFor({ subscription_status: "Active" })).toEqual(FULL_SETUP_STEPS);
    expect(setupStepsFor(undefined)).toEqual(FULL_SETUP_STEPS);
  });

  it("a free member is done with a goal, experience and days: no photo, phone, address or emergency contact", () => {
    expect(setupMissing({ subscription_status: "Free", ...training })).toEqual([]);
    expect(setupMissing({ subscription_status: "Free" })).toEqual([
      "goals",
      "training_background",
      "committed_training_days",
    ]);
  });

  it("a paid member still needs the full setup", () => {
    const missing = setupMissing({ subscription_status: "Active", ...training });
    expect(missing).toEqual([
      "avatar_url",
      "phone",
      "date_of_birth",
      "address_line1",
      "emergency_contact_name",
      "emergency_contact_phone",
    ]);
  });

  it("the database stamps setup done by the same rule", () => {
    expect(SQL).toContain(
      "(lower(btrim(coalesce(m.subscription_status, ''))) = 'free' AND m.stripe_subscription_id IS NULL)",
    );
    expect(SQL).toContain("AND array_length(m.committed_training_days, 1) >= 1");
    const wizard = readFileSync("src/components/member/member-setup-wizard.tsx", "utf8");
    expect(wizard).toContain("const STEPS = setupStepsFor(m);");
  });
});

describe("a new member gets setup first, then one popup at a time", () => {
  const member = { account_type: "jf_member", is_admin_sandbox: false };

  it("launch popups wait while setup is loading or unfinished", () => {
    expect(setupStillOpen({ status: "pending" })).toBe(true);
    expect(setupStillOpen({ status: "success", data: { complete: false, member } })).toBe(true);
    expect(setupStillOpen({ status: "success", data: { complete: true, member } })).toBe(false);
    // no setup gate mounted (a coaching client), a failed read, or an admin's sandbox: nothing to wait for
    expect(setupStillOpen(undefined)).toBe(false);
    expect(setupStillOpen({ status: "error" })).toBe(false);
    expect(
      setupStillOpen({
        status: "success",
        data: { complete: false, member: { ...member, is_admin_sandbox: true } },
      }),
    ).toBe(false);
  });

  it("pounds or kilograms is asked on setup's last step, and both launch popups wait for setup", () => {
    const wizard = readFileSync("src/components/member/member-setup-wizard.tsx", "utf8");
    expect(wizard).toContain(
      "applyWeightUnitChoice(qc, user.id, unitRow, form.weight_unit as WeightUnit)",
    );
    expect(wizard).toContain('missing.push("pounds or kilograms")');
    for (const f of [
      "src/components/home-screen-setup-gate.tsx",
      "src/components/portal/weight-unit-prompt.tsx",
    ]) {
      expect(readFileSync(f, "utf8")).toContain(
        "uiIsClear() && !setupStillOpen(qc.getQueryState(MEMBER_SETUP_STATUS_KEY))",
      );
    }
  });
});
