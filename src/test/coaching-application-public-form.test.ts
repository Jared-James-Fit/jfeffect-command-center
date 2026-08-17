import { describe, expect, it } from "vitest";
import {
  normalizeInstagramHandle,
  publicCoachingApplicationSchema,
  scoreApplication,
} from "@/lib/coaching-applications.functions";

const validLead = {
  full_name: "Jamie Prospect",
  email: "jamie@example.com",
  phone: "+1 204 555 0123",
  instagram: "jamie.lifts",
  main_goal: "powerlifting" as const,
  target_outcome: "Compete confidently in my first meet.",
  timeline: "asap" as const,
};

describe("concise public coaching application", () => {
  it("requires exactly the lead-stage essentials and normalizes Instagram safely", () => {
    const parsed = publicCoachingApplicationSchema.parse(validLead);
    expect(parsed.instagram).toBe("@jamie.lifts");
    expect(normalizeInstagramHandle("@jamie.lifts")).toBe("@jamie.lifts");
    expect(normalizeInstagramHandle("jamie.lifts")).toBe("@jamie.lifts");
  });

  it("rejects omitted or invalid Instagram handles", () => {
    expect(() => publicCoachingApplicationSchema.parse({ ...validLead, instagram: "" })).toThrow();
    expect(() => publicCoachingApplicationSchema.parse({ ...validLead, instagram: "not a handle" })).toThrow();
  });

  it("does not expect removed intake questions and scores only collected signals", () => {
    const parsed = publicCoachingApplicationSchema.parse(validLead);
    const scored = scoreApplication(parsed);
    expect(scored.scoring.version).toBe("v3_concise_lead");
    expect(scored.score).toBe(90);
    expect(scored.qualification_label).toBe("Priority Lead");
    expect(scored.recommended_offer).toBe("Powerlifting Coaching");
  });

  it("keeps timeline-driven lead prioritization deterministic", () => {
    const asap = scoreApplication(publicCoachingApplicationSchema.parse(validLead));
    const exploring = scoreApplication(publicCoachingApplicationSchema.parse({ ...validLead, timeline: "exploring" }));
    expect(asap.score).toBeGreaterThan(exploring.score);
    expect(exploring.qualification_label).toBe("Needs Review");
  });
});
