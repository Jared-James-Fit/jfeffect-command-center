import { describe, expect, it } from "vitest";
import { addPick, applyDescribed, mirrorOf, newPick, restorePick, setSideChoice, sideChoiceOf, updatePaired, scorePatch, updatePick, type PainPick } from "@/lib/pain/picks";
import { describePain } from "@/lib/pain/describe";

const knee = (side: "L" | "R", patch: Partial<PainPick> = {}): PainPick => ({ ...newPick("knee", side, "patellar_tendon"), ...patch });

describe("Left · Right · Both", () => {
  it("a sided spot shows its side; a midline spot shows no control", () => {
    const p = knee("L");
    expect(sideChoiceOf([p], p)).toBe("L");
    const spine = newPick("low_back", null, "low_spine");
    expect(sideChoiceOf([spine], spine)).toBeNull();
    const neck = newPick("neck", "L", null);
    expect(sideChoiceOf([neck], neck)).toBeNull();
  });

  it("Both adds the other side with what this one said, rated the same to start", () => {
    const p = knee("L", { ...scorePatch(5), feel: ["sharp"], timing: ["during"], exerciseName: "Competition Squat", note: "on the way up" });
    const res = setSideChoice([p], p.uid, "both");
    expect(res.picks).toHaveLength(2);
    const right = res.picks.find((x) => x.side === "R")!;
    expect(right).toMatchObject({ region: "knee", site: "patellar_tendon", score: 5, feel: ["sharp"], timing: ["during"], exerciseName: "Competition Squat", note: "on the way up" });
    expect(right.uid).not.toBe(p.uid);
    expect(res.uid).toBe(p.uid);
    expect(sideChoiceOf(res.picks, p)).toBe("both");
  });

  it("each side keeps its own rating; what it feels like goes to both", () => {
    const p = knee("L", scorePatch(5));
    let { picks } = setSideChoice([p], p.uid, "both");
    const right = picks.find((x) => x.side === "R")!;
    picks = updatePaired(picks, right.uid, scorePatch(3));
    picks = updatePaired(picks, p.uid, { feel: ["ache"] });
    expect(picks.find((x) => x.side === "L")).toMatchObject({ score: 5, feel: ["ache"] });
    expect(picks.find((x) => x.side === "R")).toMatchObject({ score: 3, feel: ["ache"] });
  });

  it("a single side again takes the other off (with it to undo)", () => {
    const p = knee("L", scorePatch(5));
    const both = setSideChoice([p], p.uid, "both");
    const right = both.picks.find((x) => x.side === "R")!;
    const back = setSideChoice(both.picks, p.uid, "L");
    expect(back.picks.map((x) => x.side)).toEqual(["L"]);
    expect(back.removed?.uid).toBe(right.uid);
    expect(restorePick(back.picks, back.removed!, 1).map((x) => x.uid)).toEqual([p.uid, right.uid]);
  });

  it("picking the other side while both are on keeps that side and its rating", () => {
    const p = knee("L", scorePatch(5));
    let { picks } = setSideChoice([p], p.uid, "both");
    const right = picks.find((x) => x.side === "R")!;
    picks = updatePick(picks, right.uid, scorePatch(2));
    const res = setSideChoice(picks, p.uid, "R");
    expect(res.picks).toHaveLength(1);
    expect(res.uid).toBe(right.uid);
    expect(res.picks[0]).toMatchObject({ side: "R", score: 2 });
  });

  it("one side moved to the other: its 'since last time' answer stays behind", () => {
    const p = knee("L", { sameIssue: true, change: "worse", continuesId: "00000000-0000-0000-0000-000000000001" });
    const res = setSideChoice([p], p.uid, "R");
    expect(res.picks[0]).toMatchObject({ side: "R", sameIssue: null, change: null, continuesId: null });
  });

  it("a place with no side yet: Both makes it the left and adds the right", () => {
    const p = newPick("shoulder", null, null);
    const res = setSideChoice([p], p.uid, "both");
    expect(res.picks.map((x) => x.side).sort()).toEqual(["L", "R"]);
  });

  it("mirrorOf ignores a different spot on the other side", () => {
    const a = knee("L");
    const b = { ...newPick("knee", "R", "kneecap") };
    expect(mirrorOf([a, b], a)).toBeNull();
  });
});

describe("Describe it → the review's places", () => {
  it("adds what was described, rated only where they said a number", () => {
    const r = describePain("Both knees have been bothering me during squats. The left is about a 5 and the right is a 3. My right shoulder also pinches during bench.");
    const { picks, uids } = applyDescribed([], r.places);
    expect(uids).toHaveLength(3);
    expect(picks.find((p) => p.region === "knee" && p.side === "L")).toMatchObject({ score: 5, severity: "moderate", timing: ["during"] });
    expect(picks.find((p) => p.region === "knee" && p.side === "R")).toMatchObject({ score: 3, severity: "mild" });
    expect(picks.find((p) => p.region === "shoulder")).toMatchObject({ score: null, severity: null, feel: ["pinch"] });
  });

  it("a place already picked is filled in, never doubled or overwritten", () => {
    const start = addPick([], { region: "knee", side: "L", site: null });
    const rated = updatePick(start.picks, start.uid, scorePatch(7));
    const { picks } = applyDescribed(rated, describePain("left knee is a 4, sharp").places);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ score: 7, feel: ["sharp"] });
  });

  it("'getting worse' answers 'since last time' only when there is a last time", () => {
    const places = describePain("right knee is getting worse, a 6").places;
    expect(applyDescribed([], places).picks[0].sameIssue).toBeUndefined();
    const prior = () => ({ id: "00000000-0000-0000-0000-000000000009", stored: true, date: "2026-11-16", score: 4, severity: "moderate" as const, site: null, trigger: null, exerciseName: null, feel: [] });
    expect(applyDescribed([], places, prior as any).picks[0]).toMatchObject({ sameIssue: true, change: "worse", continuesId: "00000000-0000-0000-0000-000000000009" });
  });
});
