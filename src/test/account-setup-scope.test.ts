import { describe, expect, it } from "vitest";
import { accountSetupRequirements } from "../lib/account-setup-scope";

describe("universal account setup scope", () => {
  it("keeps free and member onboarding lightweight", () => {
    expect(accountSetupRequirements("self_serve", [], false)).toEqual({
      memberSetup: true, basicInfo: false, headshot: false, coachingGoals: false, trainingSchedule: false, nutritionOnly: false,
    });
  });
  it("adds handling without unlocking full coaching", () => {
    expect(accountSetupRequirements("self_serve", [], true)).toMatchObject({ memberSetup: true, basicInfo: true, headshot: true, coachingGoals: false, trainingSchedule: false });
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
