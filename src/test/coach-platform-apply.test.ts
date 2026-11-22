import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COACH_STEPS,
  EMPTY_COACH_ANSWERS,
  MARKETING_CONSENT,
  PRIVACY_NOTICE,
  cleanAnswers,
  firstProblem,
  readLink,
  stepProblem,
  type CoachAnswers,
} from "@/lib/coach-platform/apply";

const full: CoachAnswers = {
  ...EMPTY_COACH_ANSWERS,
  specialties: ["powerlifting", "strength"],
  client_band: "6-15",
  works_as: "solo",
  current_platform: "trainerize",
  full_name: "  Sam   Coach ",
  business_name: "Sam Strength",
  link: "@sam.lifts",
  country: "CA",
  region: "MB",
  email: " Sam@Coach.CA ",
  privacy_ack: true,
  marketing_ok: false,
};

describe("the coach early-access application", () => {
  it("is ready only when every screen is", () => {
    expect(firstProblem(full)).toBe(-1);
    expect(firstProblem(EMPTY_COACH_ANSWERS)).toBe(0);
    expect(COACH_STEPS).toHaveLength(8);
  });

  it("never sends without the privacy notice ticked; marketing stays optional and unticked", () => {
    expect(stepProblem("contact", { ...full, privacy_ack: false })?.field).toBe("privacy_ack");
    expect(EMPTY_COACH_ANSWERS.marketing_ok).toBe(false);
    expect(EMPTY_COACH_ANSWERS.privacy_ack).toBe(false);
    expect(stepProblem("contact", { ...full, marketing_ok: false })).toBeNull();
  });

  it("asks for a province in Canada (tax follows it) and a state in the US", () => {
    expect(stepProblem("place", { ...full, region: "" })?.field).toBe("region");
    expect(stepProblem("place", { ...full, region: "XX" })?.field).toBe("region");
    expect(stepProblem("place", { ...full, country: "US", region: "TX" })).toBeNull();
    expect(stepProblem("place", { ...full, country: "OTHER", region: "" })).toBeNull();
  });

  it("the current platform is optional, the rest isn't", () => {
    expect(stepProblem("current_platform", { ...full, current_platform: "" })).toBeNull();
    expect(stepProblem("specialties", { ...full, specialties: ["yoga"] })).not.toBeNull();
    expect(stepProblem("full_name", { ...full, full_name: "S" })).not.toBeNull();
  });

  it("reads a handle as Instagram and a site as a website", () => {
    expect(readLink("@sam.lifts")).toEqual({ instagram: "@sam.lifts", website: null });
    expect(readLink("sam.lifts")).toEqual({ instagram: "@sam.lifts", website: null });
    expect(readLink("https://instagram.com/sam.lifts/?igsh=x")).toEqual({ instagram: "@sam.lifts", website: null });
    expect(readLink("samstrength.com")).toEqual({ instagram: null, website: "samstrength.com" });
    expect(readLink("https://www.samstrength.ca/coaching")).toEqual({ instagram: null, website: "https://www.samstrength.ca/coaching" });
    expect(readLink("not a link at all")).toBeNull();
  });

  it("stores trimmed, lowercased, known values only", () => {
    const c = cleanAnswers(full);
    expect(c.email).toBe("sam@coach.ca");
    expect(c.full_name).toBe("Sam Coach");
    expect(c.instagram).toBe("@sam.lifts");
    expect(c.region).toBe("MB");
    expect(cleanAnswers({ ...full, specialties: ["powerlifting", "powerlifting", "yoga"] }).specialties).toEqual(["powerlifting"]);
  });

  it("says plainly what happens to the answers, and the database stores the same values", () => {
    expect(PRIVACY_NOTICE).toMatch(/isn't shared or sold/);
    expect(PRIVACY_NOTICE).toMatch(/support@jfeffect\.com/);
    expect(MARKETING_CONSENT).toMatch(/unsubscribe/);
    const sql = readFileSync("supabase/migrations/20270509090000_coach_platform_early_access.sql", "utf8");
    for (const v of ["powerlifting", "bodybuilding", "strength", "general", "nutrition", "running", "sport", "other"]) expect(sql).toContain(`'${v}'`);
    for (const v of ["'0'", "'1-5'", "'6-15'", "'16-40'", "'41+'"]) expect(sql).toContain(v);
    // there is no switch that opens registration: it's always closed until a migration says otherwise
    expect(sql).toContain("'registration_open', false");
    expect(sql).not.toMatch(/registration_open'\s*,\s*\(/);
  });
});
