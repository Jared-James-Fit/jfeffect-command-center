import { describe, expect, it } from "vitest";
import {
  attemptsMade,
  byYear,
  careerBests,
  coachingStatus,
  competitorTier,
  honours,
  normalizeCareer,
  placeLabel,
  podiums,
  totalRecords,
  type CareerMeet,
} from "@/lib/powerlifting-career";

let n = 0;
const meet = (over: Partial<CareerMeet>): CareerMeet => ({
  id: `m${++n}`, date: "2024-01-01", meet_name: "Meet", town: null, location: "Canada-MB", federation: "CPU", level: "local",
  place: "1", division: "Open", equipment: "Raw", event: "SBD", weight_class: "74", bw_kg: 73, squat_kg: 250, bench_kg: 165,
  deadlift_kg: 280, total_kg: 695, gl: 102, dots: 500, attempts: null, entered_name: "Jared McIntyre", coached: true, ...over,
});

// From Jared's OpenPowerlifting profile.
const jared = [
  meet({ date: "2026-09-18", meet_name: "Commonwealth Championships", level: "international", place: "1", total_kg: 655, squat_kg: 235, bench_kg: 150, deadlift_kg: 270,
    attempts: { s: [227.5, 232.5, 235], b: [145, 147.5, 150], d: [247.5, 270, -280] } }),
  meet({ date: "2026-03-14", meet_name: "Nationals", level: "national", place: "2", total_kg: 662.5 }),
  meet({ date: "2025-03-01", meet_name: "Nationals", level: "national", place: "4", total_kg: 707.5 }),
  meet({ date: "2024-03-10", meet_name: "Western Canadian Championships", level: "regional", place: "2", total_kg: 720, squat_kg: 260, bench_kg: 170, deadlift_kg: 290, gl: 106.43 }),
  meet({ date: "2022-08-13", meet_name: "MPA Provincials", level: "provincial", place: "1", total_kg: 630 }),
  meet({ date: "2018-08-11", meet_name: "Movement Classic", level: "local", place: "1", total_kg: 533.5, coached: false }),
];

describe("badges", () => {
  it("competitor tier is the highest level competed at", () => {
    expect(competitorTier(jared)).toEqual({ level: "international", title: "International lifter" });
    expect(competitorTier([])).toBeNull();
  });

  it("honours: the best podium at each level, highest level first", () => {
    expect(honours(jared)).toEqual([
      { level: "international", place: 1, count: 1, title: "International champion" },
      { level: "national", place: 2, count: 1, title: "National medalist" },
    ]);
    expect(honours(jared, 4).map((h) => h.title)).toEqual(["International champion", "National medalist", "Regional medalist", "Provincial champion"]);
    expect(honours([meet({ level: "national", place: "6" }), meet({ level: "local", place: "1" })])).toEqual([]);
  });

  it("places read like a person would say them", () => {
    expect(["1", "2", "3", "4", "11", "22", "DQ", "G", null].map((p) => placeLabel(p))).toEqual(["1st", "2nd", "3rd", "4th", "11th", "22nd", "DQ", "Guest", null]);
  });
});

describe("career numbers", () => {
  it("bests across meets; a DQ's lifts don't count; bench-only meets don't set a total", () => {
    const b = careerBests([...jared, meet({ place: "DQ", squat_kg: 400, total_kg: null }), meet({ event: "B", squat_kg: null, deadlift_kg: null, bench_kg: 180, total_kg: 180 })]);
    expect(b.total?.kg).toBe(720);
    expect(b.squat?.kg).toBe(260);
    expect(b.bench?.kg).toBe(180);
    expect(b.gl?.kg).toBe(106.43);
  });

  it("total PRs: beat every earlier total (the first meet isn't a PR)", () => {
    const prs = totalRecords(jared);
    expect(jared.filter((m) => prs.has(m.id)).map((m) => m.date).sort()).toEqual(["2022-08-13", "2024-03-10"]);
  });

  it("attempts made", () => {
    expect(attemptsMade(jared[0])).toEqual({ made: 8, taken: 9 });
    expect(attemptsMade(jared[1])).toBeNull();
  });

  it("groups by year, newest first", () => {
    expect(byYear(jared).map(([y, l]) => [y, l.length])).toEqual([["2026", 2], ["2025", 1], ["2024", 1], ["2022", 1], ["2018", 1]]);
  });
});

describe("normalizeCareer / coaching status", () => {
  const raw = {
    athlete: { athlete_id: "a", display_name: "Kenneth Morris", periods: [{ start: null, end: "2024-12-14" }] },
    meets: [
      { id: "1", date: "2024-12-14", level: "local", total_kg: "585", coached: true, place: "1", event: "SBD" },
      { id: "2", date: "2023-03-18", level: "local", total_kg: "485.5", coached: true, place: "1", event: "SBD" },
      { id: "3", date: "2016-05-28", level: "provincial", total_kg: "862.5", coached: false, place: "1", event: "SBD" },
      { id: "4", date: "2016-01-01", level: "weird", total_kg: null, coached: false },
    ],
  };
  it("numbers become numbers; an unknown level reads as local", () => {
    const c = normalizeCareer(raw)!;
    expect(c.meets[0].total_kg).toBe(585);
    expect(c.meets[3].level).toBe("local");
    expect(normalizeCareer(null)).toBeNull();
  });
  const today = new Date(2026, 9, 9);
  const as = (athlete: object) => normalizeCareer({ ...raw, athlete: { ...raw.athlete, ...athlete } })!;

  it("former athlete: says so, and when (open start = year of the first coached meet)", () => {
    expect(coachingStatus(as({}), today)).toEqual({ kind: "former", title: "Former JF Effect athlete", detail: "Coached 2023 – Dec 2024" });
    expect(coachingStatus(as({ periods: [{ start: "2023-07-21", end: "2024-09-14" }] }), today).detail).toBe("Coached Jul 2023 – Sep 2024");
    expect(coachingStatus(as({ periods: [{ start: "2023-08-10", end: "2023-08-10" }] }), today).detail).toBe("Coached Aug 2023");
  });

  it("current athlete: an open period (or one ending later), unless marked retired", () => {
    expect(coachingStatus(as({ periods: [{ start: "2026-05-02", end: null }] }), today)).toEqual({ kind: "current", title: "Current JF Effect athlete", detail: "Coached since May 2026" });
    expect(coachingStatus(as({ periods: [{ start: null, end: "2026-12-31" }] }), today).kind).toBe("current");
    expect(coachingStatus(as({ periods: [{ start: null, end: null }], is_alumni: true }), today)).toEqual({ kind: "former", title: "Former JF Effect athlete", detail: "Coached 2023 – 2024" });
    expect(coachingStatus(as({ periods: [] }), today).kind).toBe("never");
  });

  it("podiums count 1st to 3rd only", () => {
    expect(podiums(jared)).toBe(5);
    expect(podiums([meet({ place: "DQ" }), meet({ place: "4" }), meet({ place: null })])).toBe(0);
  });
});
