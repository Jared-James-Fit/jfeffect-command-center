/**
 * The whole body and the symptom taxonomy (Nov 26 2026): one set of places
 * and one reading of what kind each report is, shared by the review, the
 * check-in, recovery, the coach, Cleo, programming and competition prep.
 */
import { describe, expect, it } from "vitest";
import { PAIN_REGIONS, NON_TRAINING_REGIONS, regionsInText } from "@/lib/pain/regions";
import { PAIN_SITES, expandPlaceKeys, siteCovers, siteGroups, searchSites } from "@/lib/pain/sites";
import { GENERAL_SYMPTOMS, generalSymptomsIn, limitsTraining, confirmsFatigue, symptomClass, worstClass } from "@/lib/pain/symptoms";
import { cleanReports, legacyColumns, placeLabel, reportsForOlderSchema, FEEL_KEYS } from "@/lib/pain/report";
import { buildPainHistory, entriesFromCheckinText, followUpFor, type PainEntry } from "@/lib/pain/history";
import { painHistoryForAi } from "@/lib/pain/ai";
import { PAIN_RULES } from "@/lib/pain/rules";
import { needsSafetyNotice, redFlags } from "@/lib/pain/safety";
import { needsRating, newPick, picksToReports, unrated } from "@/lib/pain/picks";
import { checkinPainReports } from "@/lib/pain/checkin-pain";
import { atlasView, sitesOnView } from "@/lib/pain/anatomy/atlas";
import { partForPlace, viewForPlace } from "@/lib/pain/anatomy/place-view";
import { partShowsMark } from "@/lib/body3d/paint";
import { liftForPlace } from "@/lib/competition/watch";
import { classifyRecovery } from "@/lib/recovery-automation/rules";
import { readFileSync } from "node:fs";

const entry = (over: Partial<PainEntry>): PainEntry => ({
  id: `e${Math.random()}`,
  stored: true,
  date: "2026-11-24",
  at: "2026-11-24T18:00:00Z",
  source: "review",
  feedbackId: null,
  dayId: null,
  region: "knee",
  side: null,
  site: null,
  severity: null,
  score: null,
  timing: [],
  trigger: null,
  exerciseName: null,
  feel: [],
  impact: null,
  sameIssue: null,
  change: null,
  continuesId: null,
  note: null,
  inferred: false,
  symptom: null,
  ...over,
});

describe("the whole body is on the map", () => {
  it("covers the head, face, jaw, ribs, hands, fingers, pelvis and feet", () => {
    const keys = new Set(PAIN_SITES.map((s) => s.key));
    for (const k of ["forehead", "temple", "back_of_head", "skull_base", "eyes", "cheek", "tmj", "jaw_muscle", "ribs_front", "ribs_side", "ribs_back", "palm", "back_of_hand", "knuckles", "index_finger", "middle_finger", "ring_finger", "little_finger", "thumb", "pubic_bone", "hip_joint", "foot_sole", "ball_of_foot", "toes", "big_toe", "foot_outer", "arch", "heel", "achilles"])
      expect(keys.has(k), k).toBe(true);
    for (const r of ["head", "face", "jaw", "ribs", "general"]) expect(PAIN_REGIONS.some((x) => x.key === r)).toBe(true);
  });

  it("draws the head on the front, back and side, each finger front and back, and the sole from the side", () => {
    const front = sitesOnView(atlasView("front"));
    const back = sitesOnView(atlasView("back"));
    const side = sitesOnView(atlasView("side", "R"));
    for (const k of ["forehead", "eyes", "temple", "jaw_muscle", "index_finger", "little_finger", "palm", "toes", "big_toe"]) expect(front.has(k), k).toBe(true);
    for (const k of ["back_of_head", "skull_base", "back_of_hand", "knuckles", "ring_finger", "ribs_back"]) expect(back.has(k), k).toBe(true);
    for (const k of ["ear", "tmj", "ball_of_foot", "arch", "foot_outer", "ribs_side"]) expect(side.has(k), k).toBe(true);
  });

  it("puts the index finger on the thumb's side of each hand", () => {
    const front = atlasView("front").parts;
    const thumb = front.find((p) => p.site === "thumb" && p.side === "R")!;
    const index = front.find((p) => p.site === "index_finger" && p.side === "R")!;
    const little = front.find((p) => p.site === "little_finger" && p.side === "R")!;
    expect(Math.abs(index.center[0] - thumb.center[0])).toBeLessThan(Math.abs(little.center[0] - thumb.center[0]));
  });

  it("a group covers its spots, draws through them and finds them", () => {
    expect(siteCovers("fingers")).toEqual(["index_finger", "middle_finger", "ring_finger", "little_finger"]);
    expect(siteCovers("hand")).toEqual(expect.arrayContaining(["palm", "fingers", "index_finger", "thumb"]));
    expect(siteGroups("ring_finger")).toEqual(expect.arrayContaining(["fingers", "hand"]));
    expect([...expandPlaceKeys(new Set(["fingers:L"]))]).toEqual(expect.arrayContaining(["index_finger:L", "little_finger:L"]));
    const where = viewForPlace("foot_sole", "ankle_foot", "L");
    expect(where.view).toBe("side");
    expect(partForPlace(atlasView(where.view, where.facing), "foot_sole", "ankle_foot", "L")?.site).toMatch(/arch|ball_of_foot/);
    expect(searchSites("pinky")[0]?.key).toBe("little_finger");
    expect(searchSites("tmj")[0]?.key).toBe("tmj");
  });

  it("older typed reports read the new places", () => {
    expect(regionsInText("jaw has been sore from clenching")[0]?.region).toBe("jaw");
    expect(regionsInText("left ribs")[0]).toEqual({ region: "ribs", side: "L" });
    expect(regionsInText("my pinky")[0]?.region).toBe("wrist_hand");
  });
});

describe("one reading of what kind a report is", () => {
  it("tells fatigue, soreness, tightness, joint, pain, numbness and general symptoms apart", () => {
    expect(symptomClass({ region: "quad", feel: ["fatigued"] })).toBe("fatigue");
    expect(symptomClass({ region: "quad", feel: ["sore"], timing: ["after"] })).toBe("soreness");
    expect(symptomClass({ region: "hamstring", feel: ["tight"] })).toBe("tightness");
    expect(symptomClass({ region: "knee", site: "patellar_tendon", feel: ["ache"] })).toBe("joint");
    expect(symptomClass({ region: "knee", feel: ["sore"] })).toBe("joint");
    expect(symptomClass({ region: "shoulder", feel: ["sharp"] })).toBe("pain");
    expect(symptomClass({ region: "quad", feel: ["sore"], score: 8 })).toBe("pain");
    expect(symptomClass({ region: "quad", feel: ["sore"], timing: ["during"] })).toBe("pain");
    expect(symptomClass({ region: "wrist_hand", site: "thumb", feel: ["numb"] })).toBe("nerve");
    expect(symptomClass({ region: "head", symptom: "headache" })).toBe("general");
    expect(symptomClass({ region: "general", symptom: "dizziness" })).toBe("general");
    // nothing said about how it feels: it came from "Anything hurt?", so it's pain, never milder
    expect(symptomClass({ region: "quad" })).toBe("pain");
    expect(worstClass(["soreness", "joint", "tightness"])).toBe("joint");
    expect(limitsTraining("joint") && limitsTraining("nerve") && !limitsTraining("soreness")).toBe(true);
    expect(confirmsFatigue("tightness") && !confirmsFatigue("general")).toBe(true);
  });

  it("reads general symptoms in people's words, and never a lift as one", () => {
    expect(generalSymptomsIn("felt lightheaded and queasy after deadlifts")).toEqual(["dizziness", "nausea"]);
    expect(generalSymptomsIn("I passed out briefly")).toEqual(["fainted"]);
    expect(generalSymptomsIn("my head is pounding")).toEqual(["headache"]);
    expect(generalSymptomsIn("heavy squats today, left knee sore")).toEqual([]);
    expect(generalSymptomsIn("sick of these lunges")).toEqual([]);
    expect(GENERAL_SYMPTOMS.every((g) => g.region === "head" || g.region === "general")).toBe(true);
  });
});

describe("reports: only the questions that matter, and nothing made up", () => {
  it("asks how bad only for pain, a joint or tendon", () => {
    expect(needsRating({ ...newPick("hamstring", "L"), feel: ["tight"] })).toBe(false);
    expect(needsRating({ ...newPick("general", null, null, "dizziness") })).toBe(false);
    expect(needsRating({ ...newPick("knee", "L", "patellar_tendon") })).toBe(true);
    expect(unrated({ ...newPick("hamstring", "L"), feel: ["tight"] })).toBe(false);
    // a tight hamstring with no rating is still kept, with no made-up band
    const sent = picksToReports([{ ...newPick("hamstring", "L"), feel: ["tight"] }, { ...newPick("general", null, null, "nausea") }]);
    expect(sent.map((r) => r.severity)).toEqual([null, null]);
    expect(sent.map((r) => r.symptom)).toEqual([null, "nausea"]);
  });

  it("keeps a symptom where it can be, and labels it by name", () => {
    const r = cleanReports([
      { region: "face", site: "eyes", side: null, symptom: "headache", severity: null },
      { region: "knee", side: "L", symptom: "dizziness", severity: "mild" },
      { region: "general", side: null, severity: null },
    ]);
    expect(r).toHaveLength(1);
    expect(placeLabel(r[0])).toBe("Headache (eye)");
    expect(placeLabel({ region: "general", side: null, symptom: "dizziness" })).toBe("Dizziness or light-headedness");
    const cols = legacyColumns([...r, { region: "general", side: null, symptom: "nausea", severity: null }, { region: "knee", side: "L", severity: "moderate", score: 5 }]);
    expect(cols.painArea).toBe("Knee (L), Headache, Nausea");
    expect(cols.painLevel).toBe(5);
  });

  it("a database without the whole body keeps what it can store", () => {
    const r = reportsForOlderSchema([
      { region: "knee", side: "L", severity: "moderate" },
      { region: "head", side: null, symptom: "headache", severity: null },
      { region: "ribs", side: null, severity: "mild" },
      { region: "hamstring", side: "R", severity: null, feel: ["tight"] },
    ]);
    expect(r.map((x) => x.region)).toEqual(["knee"]);
  });

  it("the database takes every feel and symptom the app writes", () => {
    const sql = readFileSync("supabase/migrations/20270603090000_whole_body_symptoms.sql", "utf8");
    for (const f of FEEL_KEYS) expect(sql).toContain(`'${f}'`);
    for (const g of GENERAL_SYMPTOMS) expect(sql).toContain(`'${g.key}'`);
    for (const r of PAIN_REGIONS) expect(sql).toContain(`'${r.key}'`);
  });
});

describe("safety", () => {
  it("shows the notice for weakness, a sudden headache, fainting and breathlessness", () => {
    expect(needsSafetyNotice([{ region: "wrist_hand", side: "L", severity: null, feel: ["weak"] }])).toBe(true);
    expect(needsSafetyNotice([{ region: "head", side: null, severity: null, feel: ["sudden"], symptom: "headache" }])).toBe(true);
    expect(needsSafetyNotice([{ region: "general", side: null, severity: null, symptom: "fainted" }])).toBe(true);
    expect(needsSafetyNotice([{ region: "general", side: null, severity: null, symptom: "nausea" }])).toBe(false);
    expect(needsSafetyNotice([{ region: "hamstring", side: "L", severity: null, feel: ["tight"] }])).toBe(false);
  });

  it("words general warning signs for the coach, urgent where it's urgent", () => {
    const f = redFlags([entry({ region: "general", symptom: "fainted" }), entry({ region: "head", symptom: "headache", feel: ["sudden"] })]);
    expect(f.map((x) => x.key).sort()).toEqual(["fainted", "headache_sudden"]);
    expect(f.every((x) => x.urgent)).toBe(true);
    // one headache after training is nothing to escalate; dizziness during a lift is
    expect(redFlags([entry({ region: "head", symptom: "headache", timing: ["after"] })])).toEqual([]);
    expect(redFlags([entry({ region: "general", symptom: "dizziness", timing: ["during"] })])[0]?.urgent).toBe(false);
  });

  it("a general symptom always goes to the coach, never an automatic reply", () => {
    const r = classifyRecovery([entry({ region: "general", symptom: "nausea" })], [], []);
    expect(r.risk).toBe("review");
    expect(r.reasons).toContain("symptom");
  });
});

describe("history, Cleo and the coach read the same kinds", () => {
  it("each general symptom is its own thread, never tied to a lift", () => {
    const h = buildPainHistory(
      [
        entry({ region: "head", symptom: "headache", date: "2026-11-20" }),
        entry({ region: "face", site: "eyes", symptom: "headache", date: "2026-11-23" }),
        entry({ region: "general", symptom: "dizziness", date: "2026-11-23" }),
        entry({ region: "quad", side: "L", feel: ["sore"], timing: ["after"], date: "2026-11-24" }),
      ],
      "2026-11-25",
    );
    const headache = h.areas.find((a) => a.symptom === "headache")!;
    expect(headache.entries).toHaveLength(2);
    expect(headache.label).toBe("Headache");
    expect(headache.cls).toBe("general");
    expect(headache.minor).toBe(false);
    expect(h.areas.find((a) => a.symptom === "dizziness")!.cls).toBe("general");
    expect(h.areas.find((a) => a.region === "quad")!.cls).toBe("soreness");
    const text = painHistoryForAi(h)!;
    expect(text).toMatch(/GENERAL SYMPTOMS \(not a muscle or joint; never attribute them to training/);
    expect(text).toMatch(/kind: training soreness/);
    expect(PAIN_RULES).toMatch(/GENERAL SYMPTOMS .* never put down to training/);
  });

  it("soreness that keeps coming back reads as pain", () => {
    const sore = (d: string) => entry({ region: "quad", side: "L", feel: ["sore"], timing: ["after"], date: d });
    const h = buildPainHistory([sore("2026-10-20"), sore("2026-10-29"), sore("2026-11-06"), sore("2026-11-20")], "2026-11-25");
    expect(h.areas[0].status).toBe("persistent");
    expect(h.areas[0].cls).toBe("pain");
  });

  it("the follow-up for a general symptom is the last time that symptom came up", () => {
    const prior = entry({ id: "p1", region: "general", symptom: "dizziness", date: "2026-11-10" });
    const f = followUpFor([prior, entry({ region: "knee", date: "2026-11-12" })], "general", null, { today: "2026-11-25", symptom: "dizziness" });
    expect(f?.id).toBe("p1");
  });

  it("a typed check-in reads general symptoms apart from places", () => {
    const e = entriesFromCheckinText([{ id: "c1", created_at: "2026-11-23T12:00:00Z", pain_details: "Headaches most mornings and my left knee aches on squats" }]);
    expect(e.map((x) => x.symptom ?? x.region).sort()).toEqual(["headache", "knee"]);
  });

  it("a submitted check-in's words become structured reports with the review's own reader", () => {
    const r = checkinPainReports("Left knee hurts under the kneecap on squats, about a 4. Headaches most mornings.");
    expect(r.find((x) => x.site === "patellar_tendon")).toMatchObject({ side: "L", score: 4, severity: "moderate" });
    expect(r.find((x) => x.symptom === "headache")).toMatchObject({ region: "head", severity: null });
    expect(checkinPainReports("")).toEqual([]);
  });
});

describe("the body and competition prep", () => {
  it("draws a mark on its spot and side, a group through its spots, a region on all of it", () => {
    const front = atlasView("front").parts;
    const ring = front.find((p) => p.site === "ring_finger" && p.side === "L")!;
    expect(partShowsMark(ring, { region: "wrist_hand", site: "fingers", side: "L", tone: "limit" }, true)).toBe(true);
    expect(partShowsMark(ring, { region: "wrist_hand", site: "fingers", side: "R", tone: "limit" }, true)).toBe(false);
    const forehead = front.find((p) => p.site === "forehead")!;
    expect(partShowsMark(forehead, { region: "head", site: null, side: null, tone: "general" }, true)).toBe(true);
  });

  it("names the competition lift a place loads, and never a lift for a general symptom", () => {
    expect(liftForPlace("Left ring finger")).toBe("deadlift");
    expect(liftForPlace("Right ball of foot")).toBe("squat");
    expect(liftForPlace("Side of the ribs")).toBe("bench");
    expect(liftForPlace("Headache")).toBeNull();
    expect(liftForPlace("Dizziness or light-headedness")).toBeNull();
  });

  it("never treats the head, face or jaw as trained", () => {
    expect([...NON_TRAINING_REGIONS].sort()).toEqual(["face", "general", "head", "jaw"]);
  });
});
