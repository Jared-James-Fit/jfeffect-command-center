/**
 * The voice reader on the whole body (Nov 26 2026): real-world things athletes
 * say, each read into the places and symptoms the review keeps, with nothing
 * made up and only the questions that change what happens next.
 */
import { describe, expect, it } from "vitest";
import { answerSafety, describePain, groundedPlaces, mergeDescribed, safetyQuestions, type DescribedPlace } from "@/lib/pain/describe";
import { PAIN_SITES } from "@/lib/pain/sites";
import { symptomClass } from "@/lib/pain/symptoms";
import { addPick, applyDescribed, applySafetyAnswer, newPick, pickGaps, replacePlace, unsurePatch } from "@/lib/pain/picks";

const one = (text: string) => {
  const r = describePain(text);
  return r;
};
const at = (places: DescribedPlace[], q: Partial<DescribedPlace>) =>
  places.find((p) => Object.entries(q).every(([k, v]) => (p as any)[k] === v));

describe("the brief's five sentences", () => {
  it('"The bottom of my left foot hurts."', () => {
    const r = one("The bottom of my left foot hurts.");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "ankle_foot", site: "foot_sole", side: "L", symptom: null });
    // a pain with no number: how bad decides what happens next
    expect(r.places[0].needs).toEqual(["score"]);
  });

  it('"My right thumb feels numb."', () => {
    const r = one("My right thumb feels numb.");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "wrist_hand", site: "thumb", side: "R" });
    expect(r.places[0].feel).toContain("numb");
    expect(symptomClass(r.places[0])).toBe("nerve");
    // numbness isn't asked how bad: it's asked about weakness (safety)
    expect(r.places[0].needs).toEqual([]);
    expect(safetyQuestions(r.places).map((q) => q.id)).toEqual(["weak"]);
  });

  it('"I have a headache behind my eyes."', () => {
    const r = one("I have a headache behind my eyes.");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "face", site: "eyes", symptom: "headache", side: null });
    expect(symptomClass(r.places[0])).toBe("general");
    expect(r.places[0].needs).toEqual([]);
    expect(safetyQuestions(r.places).map((q) => q.id)).toEqual(["sudden"]);
  });

  it('"My knee hurts underneath the kneecap."', () => {
    const r = one("My knee hurts underneath the kneecap.");
    // one place, the exact spot (never the knee and the tendon as two)
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "knee", site: "patellar_tendon", side: null });
    expect(r.places[0].needs).toEqual(["score", "side"]);
    expect(symptomClass(r.places[0])).toBe("joint");
  });

  it('"My lower back feels tight and my hands are tingling."', () => {
    const r = one("My lower back feels tight and my hands are tingling.");
    expect(r.places).toHaveLength(3);
    const back = at(r.places, { region: "low_back" })!;
    expect(back.feel).toEqual(["tight"]);
    expect(symptomClass(back)).toBe("tightness");
    expect(back.needs).toEqual([]);
    const hands = r.places.filter((p) => p.site === "hand");
    expect(hands.map((p) => p.side).sort()).toEqual(["L", "R"]);
    expect(hands.every((p) => p.feel.includes("numb"))).toBe(true);
    expect(hands.every((p) => !p.feel.includes("tight"))).toBe(true);
    expect(safetyQuestions(r.places).map((q) => q.id)).toEqual(["weak"]);
  });
});

describe("the whole body by name", () => {
  const cases: [string, Partial<DescribedPlace>][] = [
    ["my left ring finger hurts", { site: "ring_finger", side: "L" }],
    ["pinky on my right hand is sore", { site: "little_finger", side: "R" }],
    ["right palm is bruised", { site: "palm", side: "R" }],
    ["my knuckles ache on the left", { site: "knuckles", side: "L" }],
    ["left big toe is killing me", { site: "big_toe", side: "L" }],
    ["ball of my right foot hurts when I run", { site: "ball_of_foot", side: "R" }],
    ["my right arch is sore", { site: "arch", side: "R" }],
    ["outside of my left foot", { site: "foot_outer", side: "L" }],
    ["pain at the top of my head", { site: "top_of_head", region: "head" }],
    ["my jaw clicks and hurts", { site: "tmj", region: "jaw" }],
    ["side of my ribs on the right, sharp when I breathe in", { site: "ribs_side", region: "ribs", side: "R" }],
    ["front of my pelvis aches", { site: "pubic_bone" }],
    ["deep in my left hip joint", { site: "hip_joint", side: "L" }],
    ["base of my skull is tight", { site: "skull_base" }],
    ["my left temple is throbbing", { site: "temple", side: "L" }],
    ["achilles on the right is sore in the morning", { site: "achilles", side: "R" }],
  ];
  for (const [text, want] of cases)
    it(`"${text}"`, () => {
      const r = describePain(text);
      expect(at(r.places, want), JSON.stringify(r.places)).toBeTruthy();
    });

  it("a symptom with no place is a general symptom, never a place", () => {
    const r = describePain("felt dizzy and a bit nauseous after deadlifts");
    expect(r.places.map((p) => p.symptom).sort()).toEqual(["dizziness", "nausea"]);
    expect(r.places.every((p) => p.region === "general" && p.site == null && p.side == null)).toBe(true);
    expect(r.places.every((p) => p.needs.length === 0)).toBe(true);
    expect(safetyQuestions(r.places).map((q) => q.id)).toEqual(["fainted"]);
  });

  it("several symptoms in one recording each come back", () => {
    const r = describePain(
      "Okay so my left shoulder pinches on bench, about a 6. My quads are smoked from yesterday. I've had a headache all day and my right foot goes numb sometimes.",
    );
    expect(at(r.places, { region: "shoulder", side: "L" })!.score).toBe(6);
    const quads = r.places.filter((p) => p.region === "quad");
    expect(quads).toHaveLength(2);
    expect(quads.every((p) => p.feel.includes("fatigued") && symptomClass(p) === "fatigue")).toBe(true);
    expect(at(r.places, { symptom: "headache" })).toBeTruthy();
    const foot = at(r.places, { region: "ankle_foot", side: "R" })!;
    expect(foot.feel).toContain("numb");
  });

  it("never invents a score, a side or a feel", () => {
    const r = describePain("my neck has been bothering me a bit");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "neck", side: null, score: null });
    expect(r.places[0].feel).toEqual([]);
    // a weight is never a score
    const w = describePain("left knee hurts on squats at 225 for 5 reps");
    expect(w.places[0].score).toBeNull();
  });

  it("a fatigue word naming the session never reads as tired muscles", () => {
    const r = describePain("my left knee hurt during heavy squats");
    expect(r.places[0].feel).not.toContain("fatigued");
  });

  it("training soreness after a session needs no rating; the same ache during a lift does", () => {
    const after = describePain("hamstrings are sore after deadlifts");
    expect(after.places.every((p) => symptomClass(p) === "soreness" && p.needs.length === 0)).toBe(true);
    const during = describePain("my right hamstring aches during deadlifts");
    expect(symptomClass(during.places[0])).toBe("pain");
    expect(during.places[0].needs).toEqual(["score"]);
  });

  it("a sudden worst-ever headache is read as sudden, and a yes to the safety question adds it", () => {
    const said = describePain("worst headache of my life came on during a deadlift");
    expect(said.places[0].feel).toContain("sudden");
    expect(safetyQuestions(said.places)).toEqual([]);
    const r = describePain("got a headache after squats");
    const q = safetyQuestions(r.places)[0];
    const next = answerSafety(r.places, q);
    expect(next[0].feel).toContain("sudden");
  });

  it("numbness with the low back asks about the groin and bladder too", () => {
    const r = describePain("low back pain and my left leg is tingling");
    expect(safetyQuestions(r.places).map((q) => q.id)).toContain("cauda");
  });

  it("part of it it can't place is handed to the server, and what that finds is added", () => {
    const r = describePain("my left knee is sore. something in my gizmo hurts too");
    expect(r.places).toHaveLength(1);
    expect(r.leftover?.length).toBeGreaterThan(0);
    const merged = mergeDescribed(r, {
      places: [{ region: "abs", site: null, side: null, score: null, feel: [], timing: [], exerciseName: null, exerciseId: null, impact: null, change: null, note: "", needs: [], symptom: null }],
      unclear: [],
    });
    expect(merged.places.map((p) => p.region)).toEqual(["knee", "abs"]);
  });

  it("the server's reader can't add a symptom they didn't say", () => {
    const text = "my right thumb feels numb";
    const g = groundedPlaces(
      { places: [{ region: "general", symptom: "dizziness" }, { region: "wrist_hand", site: "thumb", side: "R", feel: ["numb", "weak"] }] },
      text,
      { sites: PAIN_SITES },
    );
    expect(g.places).toHaveLength(1);
    expect(g.places[0].feel).toEqual(["numb"]);
  });
});

describe("the whole body inside the voice-first report", () => {
  it("a correction moves a place, and a symptom said beside it stays its own", () => {
    const r = describePain("my left knee, no, the right one, about a 5. I've had a headache too");
    expect(r.places.map((p) => p.symptom ?? `${p.region}:${p.side}`).sort()).toEqual(["headache", "knee:R"]);
    expect(at(r.places, { region: "knee" })!.score).toBe(5);
  });

  it("a place said to be fine is left out, a symptom beside it isn't", () => {
    const r = describePain("my knee is fine but I'm a bit dizzy and my right thumb is numb");
    expect(r.places.some((p) => p.region === "knee")).toBe(false);
    expect(at(r.places, { symptom: "dizziness" })).toBeTruthy();
    expect(at(r.places, { site: "thumb", side: "R" })).toBeTruthy();
  });

  it("a headache is never folded into a spot on the head said beside it", () => {
    const r = describePain("headache at my temples and my jaw is sore");
    expect(r.places.filter((p) => p.symptom === "headache").length).toBeGreaterThan(0);
    expect(at(r.places, { region: "jaw", symptom: null })).toBeTruthy();
  });
});

describe("report rows: rating, safety and the map's list", () => {
  it("asks how bad only for pain, a joint or numbness, and Unsure still answers it", () => {
    const tight = { ...newPick("hamstring", "L"), feel: ["tight" as const] };
    const knee = newPick("knee", "L", "patellar_tendon");
    expect(pickGaps(tight)).toEqual([]);
    expect(pickGaps(knee)).toEqual(["score"]);
    expect(pickGaps({ ...knee, ...unsurePatch() })).toEqual([]);
    expect(pickGaps(newPick("general", null, null, "nausea"))).toEqual([]);
    // a number said for soreness is still kept
    const res = applyDescribed([], describePain("quads are sore after squats, about a 3").places);
    expect(res.picks.every((p) => p.score === 3)).toBe(true);
  });

  it("a yes to a safety question changes the places it was about; fainting is its own symptom", () => {
    const { picks } = applyDescribed([], describePain("my right thumb feels numb and I felt dizzy").places);
    const qs = safetyQuestions(picks.map((p) => ({ region: p.region, site: p.site ?? null, side: p.side ?? null, symptom: p.symptom ?? null, feel: p.feel ?? [] })));
    expect(qs.map((q) => q.id).sort()).toEqual(["fainted", "weak"]);
    let next = picks;
    for (const q of qs) next = applySafetyAnswer(next, q);
    expect(next.find((p) => p.site === "thumb")!.feel).toContain("weak");
    expect(next.some((p) => p.symptom === "fainted" && p.region === "general")).toBe(true);
    // a second yes adds nothing twice
    expect(applySafetyAnswer(next, qs.find((q) => q.id === "fainted")!)).toBe(next);
  });

  it("a symptom picked from the map's list is that symptom, and moving a headache keeps it", () => {
    const added = addPick([], { region: "general", side: null, site: null, symptom: "nausea" });
    expect(added.picks[0]).toMatchObject({ region: "general", symptom: "nausea" });
    const head = addPick([], { region: "head", side: null, site: null, symptom: "headache" });
    const moved = replacePlace(head.picks, head.uid, { region: "face", side: null, site: "eyes" });
    expect(moved.picks[0]).toMatchObject({ region: "face", site: "eyes", symptom: "headache" });
    const toKnee = replacePlace(head.picks, head.uid, { region: "knee", side: "L", site: null });
    expect(toKnee.picks[0].symptom).toBeNull();
  });
});
