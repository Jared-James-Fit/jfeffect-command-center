/**
 * The voice reader on the whole body (Nov 26 2026): real-world things athletes
 * say, each read into the places and symptoms the review keeps, with nothing
 * made up and only the questions that change what happens next.
 */
import { describe, expect, it } from "vitest";
import { answerSafety, describePain, groundedPlaces, mergeDescribed, safetyQuestions, type DescribedPlace } from "@/lib/pain/describe";
import { PAIN_SITES } from "@/lib/pain/sites";
import { symptomClass } from "@/lib/pain/symptoms";

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
