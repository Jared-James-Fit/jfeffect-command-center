import { describe, expect, it } from "vitest";
import { areaLabel, legacyAreaText, regionFromName, regionsInText } from "@/lib/pain/regions";
import { cleanReports, legacyColumns, worstSeverity } from "@/lib/pain/report";
import {
  areaSummary,
  buildPainHistory,
  entriesFromCheckinText,
  entriesFromLegacyFeedback,
  followUpFor,
  type PainEntry,
} from "@/lib/pain/history";
import { needsSafetyNotice, redFlags } from "@/lib/pain/safety";
import { recoverySuggestions } from "@/lib/pain/recovery";
import { associations, type PainSession } from "@/lib/pain/sessions";
import { draftProblems, painHistoryForAi } from "@/lib/pain/ai";

const TODAY = "2026-11-20";

let n = 0;
function entry(p: Partial<PainEntry> & Pick<PainEntry, "date" | "region">): PainEntry {
  n++;
  return {
    id: `r${n}`,
    stored: true,
    at: `${p.date}T18:00:00Z`,
    source: "review",
    feedbackId: `f${n}`,
    dayId: null,
    side: null,
    severity: "mild",
    trigger: null,
    exerciseName: null,
    feel: [],
    impact: null,
    sameIssue: null,
    change: null,
    continuesId: null,
    note: null,
    inferred: false,
    ...p,
  };
}

describe("regions", () => {
  it("labels a side the way people say it", () => {
    expect(areaLabel("shoulder", "L")).toBe("Left shoulder");
    expect(areaLabel("low_back", "R")).toBe("Low back (right side)");
    expect(areaLabel("neck", null)).toBe("Neck");
  });

  it("reads the earlier review's chips and the new labels", () => {
    expect(regionFromName("Calf / ankle")).toBe("calf");
    expect(regionFromName("Low back")).toBe("low_back");
    expect(regionFromName("Wrist / hand")).toBe("wrist_hand");
    expect(regionFromName("Hip / groin")).toBe("hip_groin");
    expect(regionFromName("Shoulder blade")).toBe("shoulder_blade");
  });

  it("finds places in what people typed under Other (real Nov 2026 notes)", () => {
    expect(regionsInText("Lower back & neck")).toEqual([
      { region: "low_back", side: null },
      { region: "neck", side: null },
    ]);
    expect(regionsInText("Mid back right side - pinch feeling")).toEqual([{ region: "mid_back", side: "R" }]);
    expect(regionsInText("Hammer curls, switched to cable hammer curls instead. Right arm tennis elbow")).toEqual([{ region: "elbow", side: "R" }]);
    expect(regionsInText("Right adductor/quad cramped")[0]).toEqual({ region: "hip_groin", side: "R" });
    expect(regionsInText("on period, dealing with a lot rn")).toEqual([]);
  });

  it("writes pain_area in the format the coach card and Program Intelligence read", () => {
    expect(legacyAreaText([{ region: "shoulder", side: "L" }, { region: "shoulder", side: "R" }, { region: "neck", side: null }])).toBe("Shoulder (L), Shoulder (R), Neck");
  });
});

describe("reports", () => {
  it("keeps one entry a place, drops an exercise without the exercise trigger and a change without 'same issue'", () => {
    const out = cleanReports([
      { region: "shoulder", side: "L", severity: "mild", trigger: "training", exerciseName: "Bench", change: "worse", sameIssue: false },
      { region: "shoulder", side: "L", severity: "moderate", trigger: "exercise", exerciseName: "Bench", sameIssue: true, change: "worse", continuesId: "00000000-0000-4000-8000-000000000001" },
      { region: "nope", side: null, severity: "mild" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "moderate", exerciseName: "Bench", change: "worse", sameIssue: true });
    const plain = cleanReports([{ region: "knee", side: "R", severity: "mild", trigger: "training", exerciseName: "Squat", sameIssue: false, change: "worse" }]);
    expect(plain[0].exerciseName).toBeNull();
    expect(plain[0].change).toBeNull();
  });

  it("fills the review's pain_area and pain_level from the worst place", () => {
    const reports = cleanReports([
      { region: "knee", side: "R", severity: "mild" },
      { region: "low_back", side: null, severity: "severe" },
    ]);
    expect(worstSeverity(reports)).toBe("severe");
    expect(legacyColumns(reports)).toEqual({ painArea: "Knee (R), Low back", painLevel: 8 });
  });
});

describe("older reports", () => {
  it("reads chips, sides and Other notes; drops v1 General with no body part", () => {
    const rows = [
      { id: "a", day_id: null, created_at: "2026-11-19T22:00:00Z", pain_area: "Shoulder (L), Shoulder (R)", pain_level: 3, client_note: null },
      { id: "b", day_id: null, created_at: "2026-11-14T22:00:00Z", pain_area: "Other", pain_level: 5, client_note: "Lower back & neck" },
      { id: "c", day_id: null, created_at: "2026-08-09T22:00:00Z", pain_area: "General", pain_level: 5, client_note: "on period, dealing with a lot rn" },
      { id: "d", day_id: null, created_at: "2026-07-08T22:00:00Z", pain_area: "General", pain_level: 5, client_note: "Shoulder discomfort" },
      { id: "e", day_id: null, created_at: "2026-10-13T22:00:00Z", pain_area: "Other", pain_level: 5, client_note: null },
    ];
    const out = entriesFromLegacyFeedback(rows, { tz: "America/Winnipeg" });
    expect(out.filter((e) => e.feedbackId === "a").map((e) => `${e.region}:${e.side}`)).toEqual(["shoulder:L", "shoulder:R"]);
    expect(out.filter((e) => e.feedbackId === "b").map((e) => e.region)).toEqual(["low_back", "neck"]);
    expect(out.filter((e) => e.feedbackId === "b").every((e) => e.inferred)).toBe(true);
    expect(out.some((e) => e.feedbackId === "c")).toBe(false);
    expect(out.find((e) => e.feedbackId === "d")?.region).toBe("shoulder");
    expect(out.find((e) => e.feedbackId === "e")?.region).toBe("other");
    // 22:00 UTC is 4 PM in Winnipeg: the athlete's own day
    expect(out[0].date).toBe("2026-11-19");
  });

  it("skips reviews already read from pain_reports", () => {
    const out = entriesFromLegacyFeedback([{ id: "a", day_id: null, created_at: "2026-11-19T22:00:00Z", pain_area: "Knee", pain_level: 3, client_note: null }], { covered: new Set(["a"]) });
    expect(out).toEqual([]);
  });

  it("reads the weekly check-in's typed pain details", () => {
    const out = entriesFromCheckinText([{ id: "c1", created_at: "2026-11-13T15:00:00Z", pain_details: "Right tennis elbow, switched dumbbell hammer curls to cable hammer curls" }]);
    expect(out[0]).toMatchObject({ region: "elbow", side: "R", source: "checkin", severity: null, inferred: true });
  });
});

describe("history", () => {
  it("one mild sore report is minor and needs nothing", () => {
    const h = buildPainHistory([entry({ date: "2026-11-18", region: "quad", feel: ["sore"] })], TODAY);
    expect(h.areas[0]).toMatchObject({ status: "new", minor: true, reasons: [] });
    expect(h.flagged).toEqual([]);
    expect(recoverySuggestions(h)).toEqual([]);
  });

  it("a shoulder that keeps coming up on bench is flagged, with the exercise (Dwayne's pattern)", () => {
    const dates = ["2026-10-27", "2026-10-28", "2026-11-12", "2026-11-16", "2026-11-19"];
    const list = dates.map((d, i) => entry({ date: d, region: "shoulder", side: i === 2 ? "L" : null, severity: i < 2 ? "moderate" : "mild", trigger: i >= 3 ? "exercise" : null, exerciseName: i >= 3 ? "Competition Bench" : null }));
    const h = buildPainHistory(list, TODAY);
    const a = h.areas[0];
    expect(a.status).toBe("persistent");
    expect(a.reasons).toContain("persistent");
    expect(a.reasons).toContain("exercise");
    expect(a.sides).toEqual({ L: 1, R: 0, none: 4 });
    expect(a.label).toBe("Shoulder");
    expect(areaSummary(a)).toMatch(/^5× in 4 weeks/);
    const s = recoverySuggestions(h);
    expect(s.map((x) => x.key)).toContain("assess");
    expect(s.find((x) => x.key === "modify")?.title).toMatch(/Competition Bench/);
  });

  it("trend: what they said beats severity; never assumes the same issue", () => {
    const first = entry({ date: "2026-11-10", region: "knee", side: "R", severity: "mild" });
    const second = entry({ date: "2026-11-17", region: "knee", side: "R", severity: "mild", sameIssue: true, change: "worse", continuesId: first.id });
    expect(buildPainHistory([first, second], TODAY).areas[0]).toMatchObject({ trend: "worse", trendFrom: "client" });
    expect(buildPainHistory([first, second], TODAY).areas[0].reasons).toContain("worse");
    const third = entry({ date: "2026-11-17", region: "knee", side: "R", severity: "moderate" });
    expect(buildPainHistory([first, third], TODAY).areas[0]).toMatchObject({ trend: "worse", trendFrom: "severity" });
  });

  it("a place not reported for 3+ weeks has gone quiet and isn't flagged", () => {
    const h = buildPainHistory([entry({ date: "2026-10-01", region: "low_back", severity: "severe", impact: "stopped" })], TODAY);
    expect(h.areas[0].status).toBe("quiet");
    expect(h.flagged).toEqual([]);
  });

  it("severe or a stopped session in the last two weeks wants the coach", () => {
    const h = buildPainHistory([entry({ date: "2026-11-19", region: "hamstring", side: "L", severity: "severe", impact: "stopped", feel: ["pop"] })], TODAY);
    expect(h.flagged[0].reasons.slice(0, 3)).toEqual(["red_flag", "severe", "stopped"]);
  });

  it("follow-up finds the last report of that place, same side or side not said", () => {
    const list = [
      entry({ date: "2026-11-12", region: "shoulder", side: "L", severity: "moderate", exerciseName: "Bench", trigger: "exercise" }),
      entry({ date: "2026-11-16", region: "shoulder", side: "R" }),
    ];
    expect(followUpFor(list, "shoulder", "L", { today: TODAY })).toMatchObject({ date: "2026-11-12", exerciseName: "Bench" });
    expect(followUpFor(list, "knee", "L", { today: TODAY })).toBeNull();
    expect(followUpFor(list, "shoulder", "L", { today: TODAY, feedbackId: list[0].feedbackId })).toBeNull();
  });
});

describe("safety", () => {
  it("shows the notice only for what calls for it", () => {
    expect(needsSafetyNotice([{ region: "knee", side: "R", severity: "mild" }])).toBe(false);
    expect(needsSafetyNotice([{ region: "knee", side: "R", severity: "severe" }])).toBe(true);
    expect(needsSafetyNotice([{ region: "elbow", side: "R", severity: "mild", feel: ["numb"] }])).toBe(true);
    expect(needsSafetyNotice([{ region: "chest", side: "L", severity: "moderate", trigger: "daily" }])).toBe(true);
    expect(needsSafetyNotice([{ region: "chest", side: "L", severity: "moderate", trigger: "exercise" }])).toBe(false);
  });

  it("numbness with back pain asks about the urgent signs", () => {
    const flags = redFlags([entry({ date: "2026-11-19", region: "low_back", feel: ["numb"] })]);
    expect(flags[0]).toMatchObject({ key: "nerve_back", urgent: true });
    expect(recoverySuggestions(buildPainHistory([entry({ date: "2026-11-19", region: "low_back", feel: ["numb"] })], TODAY))[0].key).toBe("urgent");
  });
});

describe("recovery suggestions", () => {
  it("heat and soft-tissue only for recurring muscular tightness with no warning signs", () => {
    const tight = [entry({ date: "2026-11-12", region: "upper_back", feel: ["tight"] }), entry({ date: "2026-11-18", region: "upper_back", feel: ["tight"] })];
    const keys = recoverySuggestions(buildPainHistory(tight, TODAY)).map((s) => s.key);
    // one comfort measure, and no "keep moving" lecture for a mild niggle
    expect(keys).toEqual(["heat"]);
    const hammy = [entry({ date: "2026-11-12", region: "hamstring", side: "L", feel: ["tight"] }), entry({ date: "2026-11-18", region: "hamstring", side: "L", feel: ["tight"] })];
    expect(recoverySuggestions(buildPainHistory(hammy, TODAY)).map((s) => s.key)).toEqual(["soft_tissue"]);
    const back = [entry({ date: "2026-11-12", region: "low_back", feel: ["ache"], severity: "moderate" }), entry({ date: "2026-11-18", region: "low_back", feel: ["ache"] })];
    expect(recoverySuggestions(buildPainHistory(back, TODAY)).map((s) => s.key)).toEqual(["keep_moving", "heat"]);
    const swollen = [entry({ date: "2026-11-12", region: "calf", side: "L", feel: ["tight"] }), entry({ date: "2026-11-18", region: "calf", side: "L", feel: ["tight", "swollen"] })];
    expect(recoverySuggestions(buildPainHistory(swollen, TODAY)).map((s) => s.key)).not.toContain("heat");
    const elbow = [entry({ date: "2026-11-12", region: "elbow", side: "R", feel: ["ache"] }), entry({ date: "2026-11-18", region: "elbow", side: "R", feel: ["ache"] })];
    expect(recoverySuggestions(buildPainHistory(elbow, TODAY)).map((s) => s.key)).not.toContain("heat");
  });

  it("doesn't repeat what the coach already suggested unless it got worse", () => {
    const tight = [entry({ date: "2026-11-12", region: "upper_back", feel: ["tight"] }), entry({ date: "2026-11-18", region: "upper_back", feel: ["tight"] })];
    const now = Date.parse(`${TODAY}T12:00:00Z`);
    const given = [{ key: "heat", region: "upper_back", at: "2026-11-13T12:00:00Z" }];
    expect(recoverySuggestions(buildPainHistory(tight, TODAY), [], given, now).map((s) => s.key)).not.toContain("heat");
    const worse = [...tight, entry({ date: "2026-11-19", region: "upper_back", feel: ["tight"], severity: "severe" })];
    expect(recoverySuggestions(buildPainHistory(worse, TODAY), [], given, now).map((s) => s.key)).not.toContain("heat"); // severe: no comfort measures
  });

  it("a physio suggestion that didn't settle it becomes a follow-up", () => {
    const list = ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-19"].map((d) => entry({ date: d, region: "knee", side: "R", severity: "moderate" }));
    const s = recoverySuggestions(buildPainHistory(list, TODAY), [], [{ key: "assess", region: "knee", at: "2026-11-10T12:00:00Z" }], Date.parse(`${TODAY}T12:00:00Z`));
    expect(s.map((x) => x.key)).toContain("follow_up");
    expect(s.map((x) => x.key)).not.toContain("assess");
  });
});

describe("associations", () => {
  const sessions: PainSession[] = [
    { date: "2026-10-27", exercises: ["Competition Bench", "Squat"], sessionRpe: 7, sleep: null, energy: null },
    { date: "2026-10-28", exercises: ["Deadlift", "Row"], sessionRpe: 7, sleep: null, energy: null },
    { date: "2026-10-30", exercises: ["Competition Bench", "Pull Up"], sessionRpe: 9, sleep: "5_6", energy: null },
    { date: "2026-11-03", exercises: ["Squat", "Leg Press"], sessionRpe: 7, sleep: null, energy: null },
    { date: "2026-11-06", exercises: ["Competition Bench", "Squat"], sessionRpe: 9, sleep: "lt5", energy: null },
    { date: "2026-11-10", exercises: ["Deadlift"], sessionRpe: 7, sleep: null, energy: null },
    { date: "2026-11-13", exercises: ["Close Grip Bench", "Squat"], sessionRpe: 8, sleep: null, energy: null },
  ];
  it("names the exercise or movement the pain days had in common, against how often they train it", () => {
    const area = { entries: ["2026-10-27", "2026-10-30", "2026-11-06", "2026-11-13"].map((d) => entry({ date: d, region: "shoulder" })) };
    const as = associations(area, sessions);
    expect(as[0]).toMatchObject({ kind: "pattern", with: 4, of: 4 });
    expect(as[0].name).toBe("Competition Bench");
  });
  it("never guesses beside an exercise they named, and never offers a movement that can't load the place", () => {
    const named = { region: "shoulder", named: [{ name: "Competition Bench", count: 2 }], entries: ["2026-10-27", "2026-10-30", "2026-11-06", "2026-11-13"].map((d) => entry({ date: d, region: "shoulder" })) };
    expect(associations(named, sessions)).toEqual([]);
    const knee = { region: "knee", entries: ["2026-10-27", "2026-10-30", "2026-11-06", "2026-11-13"].map((d) => entry({ date: d, region: "knee", side: "R" })) };
    expect(associations(knee, sessions).some((a) => a.pattern === "Horizontal press" || a.name.includes("Bench"))).toBe(false);
  });
  it("a lift in every session is never the reason", () => {
    const every = sessions.map((s) => ({ ...s, exercises: [...s.exercises, "Plank"] }));
    const area = { entries: ["2026-10-28", "2026-11-03", "2026-11-10"].map((d) => entry({ date: d, region: "abs" })) };
    expect(associations(area, every).some((a) => a.name === "Plank")).toBe(false);
  });
});

describe("AI text", () => {
  it("states facts and options, and never invents a diagnosis", () => {
    const list = ["2026-11-02", "2026-11-09", "2026-11-16"].map((d, i) => entry({ date: d, region: "shoulder", side: "L", severity: "mild", note: i === 2 ? "bench felt pinchy" : null }));
    const h = buildPainHistory(list, TODAY);
    const text = painHistoryForAi(h, { suggestions: recoverySuggestions(h) })!;
    expect(text).toContain("PAIN HISTORY");
    expect(text).toContain("Left shoulder");
    expect(text).toContain('"bench felt pinchy"');
    expect(text).toContain("RECOVERY OPTIONS");
    expect(painHistoryForAi(buildPainHistory([], TODAY))).toBeNull();
  });
  it("flags clinical and wellness-app words in a draft", () => {
    expect(draftProblems("Sounds like tendinitis, ice it and take ibuprofen")).toEqual(["tendinitis", "ice it", "ibuprofen"]);
    expect(draftProblems("That left shoulder has come up a few times now. Let's stop forcing the movements that aggravate it.")).toEqual([]);
  });
});
