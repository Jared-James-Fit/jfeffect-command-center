/**
 * The pain report's places (Nov 26 2026): saying more never makes a second
 * copy of one place, Unsure is an answer (with no number standing in), and
 * what's still needed is one rule the button and the rows share.
 */
import { describe, expect, it } from "vitest";
import { describePain } from "@/lib/pain/describe";
import {
  addPick,
  applyDescribed,
  applyDetail,
  firstGap,
  needsScore,
  pickGaps,
  picksToReports,
  replacePlace,
  scorePatch,
  unsurePatch,
  updatePick,
  type PainPick,
} from "@/lib/pain/picks";
import { cleanReports, legacyColumns, painReportsSchema } from "@/lib/pain/report";

const say = (picks: PainPick[], words: string) => applyDescribed(picks, describePain(words).places);

describe("saying more joins the place already there", () => {
  it("a side said later makes the place exact, never a second knee", () => {
    let r = say([], "my knee hurts on squats");
    expect(r.picks).toHaveLength(1);
    expect(pickGaps(r.picks[0])).toEqual(["side", "score"]);
    r = say(r.picks, "the left knee, about a 4");
    expect(r.picks).toHaveLength(1);
    expect(r.picks[0]).toMatchObject({ region: "knee", side: "L", score: 4 });
    expect(pickGaps(r.picks[0])).toEqual([]);
  });

  it("a spot said later makes the area exact", () => {
    let r = say([], "left knee is a 3");
    r = say(r.picks, "it's right below the kneecap on the left knee");
    expect(r.picks).toHaveLength(1);
    expect(r.picks[0]).toMatchObject({ site: "patellar_tendon", side: "L", score: 3 });
  });

  it("the neck said three times is one neck", () => {
    let r = say([], "my neck is tight");
    r = say(r.picks, "neck is like a 3");
    r = say(r.picks, "back of my neck mostly");
    expect(r.picks).toHaveLength(1);
    expect(r.picks[0]).toMatchObject({ region: "neck", site: "neck_back", score: 3 });
  });

  it("a different symptom in the same region stays its own place", () => {
    let r = say([], "right shoulder pinches on bench");
    r = say(r.picks, "and my right rear delt is sore");
    expect(r.picks).toHaveLength(2);
  });

  it("a number said again replaces one said before, never one they tapped", () => {
    let r = say([], "left hip is a 3");
    r = say(r.picks, "left hip, actually more like a 5");
    expect(r.picks[0].score).toBe(5);
    const tapped = updatePick(r.picks, r.picks[0].uid, scorePatch(2));
    r = say(tapped, "left hip is a 7");
    expect(r.picks[0].score).toBe(2);
  });

  it("the same place picked on the map and then described is one place", () => {
    const map = addPick([], { region: "elbow", side: "R", site: null });
    const r = say(map.picks, "right elbow aches after bench, a 2");
    expect(r.picks).toHaveLength(1);
    expect(r.picks[0]).toMatchObject({ uid: map.uid, score: 2, feel: ["ache"] });
  });
});

describe("said about no place: the place it's about", () => {
  it("fills the one given, a number only to one place", () => {
    const r = say([], "left knee hurts");
    const d = describePain("it's sharp, about a 6").detail!;
    const next = applyDetail(r.picks, d, [r.picks[0].uid]);
    expect(next[0]).toMatchObject({ score: 6, feel: ["sharp"] });
    const two = say([], "both knees hurt");
    const both = applyDetail(two.picks, d, two.picks.map((p) => p.uid));
    expect(both.every((p) => p.score == null && p.feel?.includes("sharp"))).toBe(true);
  });
});

describe("Unsure", () => {
  it("answers how bad with no number, and is sent and stored that way", () => {
    const r = say([], "low back is tight");
    const p = updatePick(r.picks, r.picks[0].uid, unsurePatch())[0];
    expect(needsScore(p)).toBe(false);
    expect(pickGaps(p)).toEqual([]);
    const reports = picksToReports([p]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ region: "low_back", score: null, severity: null });
    expect(painReportsSchema.safeParse(reports).success).toBe(true);
    // the review's legacy level is the worst rated place, or none when nothing was rated
    expect(legacyColumns(reports)).toMatchObject({ painLevel: null });
    expect(legacyColumns(cleanReports([...reports, { region: "knee", side: "L", severity: "mild", score: 3 }])).painLevel).toBe(3);
  });

  it("a number later replaces Unsure", () => {
    const r = say([], "low back is tight");
    const unsure = updatePick(r.picks, r.picks[0].uid, unsurePatch());
    const next = say(unsure, "low back is a 4");
    expect(next.picks[0]).toMatchObject({ score: 4, unsure: false });
  });
});

describe("what's still needed", () => {
  it("in order: where, side, how bad", () => {
    expect(pickGaps(addPick([], { region: "other", side: null }).picks[0])).toEqual(["where", "score"]);
    const knee = addPick([], { region: "knee", side: null }).picks;
    expect(firstGap(knee)?.gap).toBe("side");
    expect(firstGap(updatePick(knee, knee[0].uid, { side: "R", ...scorePatch(4) }))).toBeNull();
    // a midline place needs no side
    expect(pickGaps(addPick([], { region: "low_back", side: null }).picks[0])).toEqual(["score"]);
  });
});

describe("moving a place on the body", () => {
  it("keeps what was said; onto a place already picked, the two are one", () => {
    let r = say([], "left knee sore on squats, a 4");
    const moved = replacePlace(r.picks, r.picks[0].uid, { region: "knee", side: "L", site: "patellar_tendon" });
    expect(moved.picks).toHaveLength(1);
    expect(moved.picks[0]).toMatchObject({ site: "patellar_tendon", score: 4, feel: ["sore"] });
    r = say(moved.picks, "my right hip is tight");
    const hip = r.picks.find((p) => p.region === "hip_groin")!;
    const merged = replacePlace(r.picks, hip.uid, { region: "knee", side: "L", site: "patellar_tendon" });
    expect(merged.picks).toHaveLength(1);
    expect(merged.picks[0].feel).toEqual(expect.arrayContaining(["sore", "tight"]));
  });
});

import { blockShift, blockShiftLine, type PainSession } from "@/lib/pain/sessions";

describe("changes across training blocks (the coach's read)", () => {
  const s = (date: string, block: string): PainSession => ({ date, exercises: [], sessionRpe: null, sleep: null, energy: null, block: { id: block, name: block === "b1" ? "Hypertrophy" : "Strength" } });
  const sessions = [s("2026-10-01", "b1"), s("2026-10-03", "b1"), s("2026-10-06", "b1"), s("2026-10-08", "b1"), s("2026-11-02", "b2"), s("2026-11-04", "b2"), s("2026-11-09", "b2"), s("2026-11-11", "b2")];
  const entry = (date: string) => ({ date, source: "review" }) as any;

  it("says a clear change, per session", () => {
    const b = blockShift({ entries: [entry("2026-11-02"), entry("2026-11-09"), entry("2026-11-11")] }, sessions)!;
    expect(b).toMatchObject({ direction: "more", current: { name: "Strength", pain: 3, sessions: 4 }, previous: { name: "Hypertrophy", pain: 0, sessions: 4 } });
    expect(blockShiftLine(b)).toContain("3 of 4 sessions this block (Strength)");
  });

  it("says nothing for one report or no blocks", () => {
    expect(blockShift({ entries: [entry("2026-11-02")] }, sessions)).toBeNull();
    expect(blockShift({ entries: [entry("2026-11-02"), entry("2026-11-04")] }, sessions.map((x) => ({ ...x, block: null })))).toBeNull();
  });
});
