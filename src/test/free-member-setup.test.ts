import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FREE_SETUP_STEPS,
  FULL_SETUP_STEPS,
  isFreeAccount,
  setupMissing,
  setupStepsFor,
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
