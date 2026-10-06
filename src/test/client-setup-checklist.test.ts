import { describe, expect, it } from "vitest";
import { setupChecklistSteps } from "@/lib/client-setup-checklist";
import { isActiveClient, type AgreementState } from "@/lib/coaching-agreement/rules";

const BASICS = {
  first_name: "Jane", last_name: "Doe", phone: "+12045550100", date_of_birth: "1995-04-01",
  height_cm: 170, address: "1 Main St", city: "Selkirk", country: "Canada",
  timezone: "America/Winnipeg", emergency_contact_name: "John Doe", emergency_contact_phone: "+12045550101",
};
const DONE_CLIENT = {
  ...BASICS,
  profile_picture_url: "clients/jane.jpg",
  profile_picture_needs_update: false,
  training_schedule_completed: true,
};
const DONE_GOALS = {
  main_goal: "Build muscle", training_days_per_week: 4, workout_length_minutes: 60,
  training_experience: "Intermediate", training_location: "Gym", nutrition_goal: "Maintain",
} as any;
const NEEDS_SIGNATURE: AgreementState = {
  state: "needs_signature", reason: "never_signed", previous: null, requestedAt: null, requestNote: null,
};
const SIGNED = { state: "signed", signature: {} } as unknown as AgreementState;

const keys = (steps: { key: string }[]) => steps.map((s) => s.key);

describe("setupChecklistSteps", () => {
  it("leads with the agreement when it applies", () => {
    const steps = setupChecklistSteps({ client: DONE_CLIENT, goals: DONE_GOALS, agreement: NEEDS_SIGNATURE });
    expect(keys(steps)).toEqual(["agreement", "profile_picture", "basic_info", "training_schedule", "goals_setup"]);
    expect(steps[0].done).toBe(false);
  });

  it("leaves the agreement out when it doesn't apply", () => {
    expect(keys(setupChecklistSteps({ client: DONE_CLIENT, goals: DONE_GOALS, agreement: null }))).not.toContain("agreement");
  });

  it("is all done for a client who finished every step", () => {
    const steps = setupChecklistSteps({ client: DONE_CLIENT, goals: DONE_GOALS, agreement: SIGNED });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it("has nothing done for a brand-new client", () => {
    const steps = setupChecklistSteps({ client: {}, goals: null, agreement: NEEDS_SIGNATURE });
    expect(steps.some((s) => s.done)).toBe(false);
  });

  it("counts the schedule as set from training_schedule_completed, not preferred_training_days", () => {
    const steps = setupChecklistSteps({
      client: { ...DONE_CLIENT, preferred_training_days: [] },
      goals: DONE_GOALS,
    });
    expect(steps.find((s) => s.key === "training_schedule")?.done).toBe(true);
  });

  it("treats a photo the coach asked to retake as not done", () => {
    const steps = setupChecklistSteps({
      client: { ...DONE_CLIENT, profile_picture_needs_update: true },
      goals: DONE_GOALS,
    });
    expect(steps.find((s) => s.key === "profile_picture")?.done).toBe(false);
  });
});

describe("isActiveClient", () => {
  it("applies only to current clients who can use the portal", () => {
    expect(isActiveClient({ status: "Active" })).toBe(true);
    expect(isActiveClient({ status: "Active", archived: true })).toBe(false);
    expect(isActiveClient({ status: "Active", portal_access_disabled: true })).toBe(false);
    expect(isActiveClient({ status: "Deactivated" })).toBe(false);
    expect(isActiveClient({ status: "Archived" })).toBe(false);
    expect(isActiveClient(null)).toBe(false);
  });
});
