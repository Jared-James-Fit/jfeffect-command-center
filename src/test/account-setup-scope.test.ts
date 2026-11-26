import { describe, expect, it } from "vitest";
import { accountSetupRequirements } from "../lib/account-setup-scope";

describe("universal account setup scope", () => {
  it("keeps free and member onboarding lightweight", () => {
    expect(accountSetupRequirements("self_serve", [], false)).toEqual({
      memberSetup: true, basicInfo: false, headshot: false, coachingGoals: false, generalGoals: false, trainingSchedule: false, nutritionOnly: false,
    });
  });
  it("requires ordinary goals questions for handling without unlocking full coaching", () => {
    expect(accountSetupRequirements("self_serve", [], true)).toMatchObject({ memberSetup: true, basicInfo: true, headshot: true, coachingGoals: false, generalGoals: true, trainingSchedule: false });
  });
  it("preserves nutrition intake for nutrition-only coaching", () => {
    expect(accountSetupRequirements("coaching", ["nutrition"], false)).toMatchObject({ coachingGoals: true, nutritionOnly: true, trainingSchedule: false });
  });
  it("combines multiple coaching services and handling", () => {
    expect(accountSetupRequirements("coaching", ["nutrition", "powerlifting"], true)).toMatchObject({ memberSetup: false, basicInfo: true, coachingGoals: true, trainingSchedule: true, nutritionOnly: false });
  });
  it("keeps existing coaching intake for legacy accounts without a package", () => {
    expect(accountSetupRequirements("coaching", [], false)).toMatchObject({ coachingGoals: true, trainingSchedule: true });
  });
});

import { fillMissing, memberBasicPrefill, memberIntakePrefill } from "../lib/account-setup-prefill";
describe("previous account intake reuse", () => {
  it("maps only one unambiguous goal, never chooses among multiple goals", () => {
    expect(memberIntakePrefill({ goals_tags: ["Lose fat"] })).toEqual({ main_goal: "Lose body fat" });
    expect(memberIntakePrefill({ goals_tags: ["Lose fat", "Build muscle"] })).toEqual({});
    expect(memberIntakePrefill({ goals: "a different target" })).toEqual({});
  });
  it("fills missing contact fields without overwriting existing profile details", () => {
    const defaults = memberBasicPrefill({ phone: "1234567", address_city: "Winnipeg", emergency_contact_phone: "7654321", avatar_url: "ignored" });
    expect(fillMissing({ phone: "existing", city: null }, defaults)).toEqual({ phone: "existing", city: "Winnipeg", emergency_contact_phone: "7654321" });
  });
});


import { firstPendingHandlingMeet } from "../lib/account-setup-scope";
describe("guided handling intake", () => {
  it("automatically selects the first outstanding assigned competition", () => {
    expect(firstPendingHandlingMeet([{ id: "complete", done: true }, { id: "terms-or-intake", done: false }, { id: "next", done: false }])?.id).toBe("terms-or-intake");
  });
  it("does not prompt unassigned or completed athletes", () => {
    expect(firstPendingHandlingMeet([])).toBeUndefined();
    expect(firstPendingHandlingMeet([{ id: "complete", done: true }])).toBeUndefined();
  });
});


it("uses the full shared questionnaire for nutrition plus handling without changing the service tier", () => {
  expect(accountSetupRequirements("coaching", ["nutrition"], true)).toMatchObject({generalGoals: true, nutritionOnly: false});
});

import { memberSetupSummary } from "../lib/member-setup-steps";
describe("shared membership status", () => {
  it("does not assign unrelated membership intake to program-only handling", () => {
    expect(memberSetupSummary({ account_type: "program_only" }).applicable).toBe(false);
  });
  it("reports exactly the lightweight free requirements and completed status", () => {
    const free = { account_type: "jf_member", subscription_status: "Free" };
    expect(memberSetupSummary(free).missing).toEqual(["goals", "training_background", "committed_training_days"]);
    expect(memberSetupSummary({ ...free, goals: "Powerlifting", experience_level: "intermediate", committed_training_days: ["Monday"] })).toMatchObject({ applicable: true, complete: true, free: true, missing: [] });
  });
  it("preserves full paid member setup and excludes sandbox", () => {
    expect(memberSetupSummary({ account_type: "jf_member", stripe_subscription_id: "paid" }).missing).toContain("emergency_contact_phone");
    expect(memberSetupSummary({ account_type: "jf_member", is_admin_sandbox: true }).applicable).toBe(false);
  });
});
