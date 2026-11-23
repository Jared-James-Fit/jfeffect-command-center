import { describe, expect, it } from "vitest";
import { buildIntelReport } from "@/lib/program-intel/report";
import { consolidatePain, painNeedsLook, painPlaceLine, painPlaceName, placesInReport } from "@/lib/program-intel/pain-read";
import { overLimit, sessionLimit } from "@/lib/program-intel/session-limit";
import { fixture } from "./program-intel-fixture";
import { bodybuilder } from "./program-intel-scenarios";

describe("pain is read once per place", () => {
  const reports = [
    { date: "2026-10-01", area: "Shoulder (L)", level: 3, note: null },
    { date: "2026-10-08", area: "Shoulder (L), Low back", level: 4, note: "pinch on bench" },
    { date: "2026-10-15", area: "Other", level: 6, note: "left shoulder again on incline" },
    { date: "2026-10-22", area: "Left shoulder", level: 7, note: null },
    { date: "2026-10-22", area: "Knee", level: 2, note: null },
  ];

  it("splits a report into its places with the pain library's reader", () => {
    expect(placesInReport(reports[1]).map((p) => [p.key, p.side])).toEqual([["shoulder", "L"], ["low_back", null]]);
    expect(placesInReport(reports[2]).map((p) => [p.key, p.side])).toEqual([["shoulder", "L"]]);
    expect(placesInReport({ date: null, area: "General", level: 2, note: "just tired" })).toEqual([]);
    expect(placesInReport({ date: null, area: "Other", level: 2, note: "weird feeling" }).map((p) => p.key)).toEqual(["other"]);
  });

  it("counts the same shoulder once, however it was written", () => {
    const places = consolidatePain(reports);
    const shoulder = places.find((p) => p.key === "shoulder")!;
    expect(places[0].key).toBe("shoulder");
    expect(shoulder.reports).toBe(4);
    expect(shoulder.days).toBe(4);
    expect(shoulder.worst).toBe(7);
    expect(shoulder.trend).toBe("worse");
    expect(painPlaceName(shoulder)).toBe("Left shoulder");
    expect(painPlaceLine(shoulder)).toContain("4 reports");
    expect(painNeedsLook(shoulder)).toBe(true);
    const knee = places.find((p) => p.key === "knee")!;
    expect(knee.reports).toBe(1);
    expect(painNeedsLook(knee)).toBe(false);
    expect(places.filter((p) => p.key === "shoulder")).toHaveLength(1);
  });

  it("names both sides", () => {
    const both = consolidatePain([
      { date: "2026-10-01", area: "Knee (L)", level: 3, note: null },
      { date: "2026-10-03", area: "Knee (R)", level: 3, note: null },
    ]);
    expect(painPlaceName(both[0])).toBe("Both knees");
  });

  it("the report's findings say each place once", () => {
    const rec = fixture({
      feedback: [
        { id: "f1", day_id: "d1a", completion_id: "c1", created_at: "2026-10-06T19:05:00Z", session_rpe: 7, overall_rating: 4, strength_feel: null, fatigue_feel: "normal", hit_target: null, recovery_today: null, sleep_bucket: "7-8", pain: true, pain_area: "Shoulder (L)", pain_level: 3, pain_note: null, client_note: null, review_version: 2 },
        { id: "f2", day_id: "d1b", completion_id: "c2", created_at: "2026-10-08T19:05:00Z", session_rpe: 7, overall_rating: 4, strength_feel: null, fatigue_feel: "normal", hit_target: null, recovery_today: null, sleep_bucket: "7-8", pain: true, pain_area: "Shoulder (L), Low back", pain_level: 4, pain_note: null, client_note: null, review_version: 2 },
      ] as any,
    });
    const r = buildIntelReport(rec);
    const pain = r.findings.filter((f) => f.id.startsWith("recovery:pain:"));
    expect(pain.map((f) => f.id).sort()).toEqual(["recovery:pain:low_back", "recovery:pain:shoulder"]);
    expect(pain.find((f) => f.id === "recovery:pain:shoulder")!.title).toContain("2 reports");
  });
});

describe("competition lifts a program never had are context, not missing data", () => {
  it("a bodybuilding block read as powerlifting says it once", () => {
    const r = buildIntelReport(bodybuilder(), { brainOverride: "powerlifting" });
    expect(r.findings.filter((f) => /^pl:(squat|bench|deadlift):few$/.test(f.id))).toEqual([]);
    const ctx = r.findings.filter((f) => f.id === "pl:comp-not-programmed");
    expect(ctx).toHaveLength(1);
    expect(ctx[0].kind).toBe("fact");
    expect(ctx[0].area).not.toBe("missing");
    expect(ctx[0].title).toMatch(/squat, bench and deadlift/);
  });

  it("a programmed lift with too few logs is still missing data", () => {
    // the fixture programs squat and bench; bench was logged once (week 2 missed)
    const r = buildIntelReport(fixture(), { brainOverride: "powerlifting" });
    expect(r.findings.some((f) => f.id === "pl:bench:few" && f.kind === "missing")).toBe(true);
    // deadlift was never programmed: context, not missing
    expect(r.findings.some((f) => f.id === "pl:deadlift:few")).toBe(false);
    expect(r.findings.find((f) => f.id === "pl:comp-not-programmed")?.title).toMatch(/deadlift wasn't/);
  });
});

describe("one session limit everywhere", () => {
  it("the booked PT hour wins when it's the shorter", () => {
    expect(sessionLimit({ goalsMinutes: 90, ptMinutes: 60 })).toMatchObject({ minutes: 60, source: "pt" });
    expect(sessionLimit({ goalsMinutes: 45, ptMinutes: 60 })).toMatchObject({ minutes: 45, source: "goals" });
    expect(sessionLimit({ goalsMinutes: null, ptMinutes: null })).toMatchObject({ minutes: null, source: null });
    expect(sessionLimit({ goalsMinutes: 75 }).phrase).toContain("75-minute limit");
  });
  it("a few minutes over isn't over", () => {
    expect(overLimit(64, 60)).toBe(false);
    expect(overLimit(66, 60)).toBe(true);
    expect(overLimit(null, 60)).toBe(false);
  });
});
