/**
 * The voice-first pain report's reader (Nov 26 2026): natural speech,
 * corrections, a place said to be fine, lifting words, the anatomy the map
 * names, and one issue said twice kept as one place.
 */
import { describe, expect, it } from "vitest";
import { describePain, reconcilePlaces } from "@/lib/pain/describe";

const workout = [
  { id: "ex-squat", name: "Competition Squat" },
  { id: "ex-bench", name: "Competition Bench Press" },
  { id: "ex-dl", name: "Sumo Deadlift" },
  { id: "ex-hack", name: "Hack Squat" },
];
const find = (r: ReturnType<typeof describePain>, region: string, side: string | null, site: string | null = null) =>
  r.places.find((p) => p.region === region && p.side === side && p.site === site);

describe("corrections", () => {
  it("a place said again after 'no' or 'actually' replaces the one before, keeping what was said", () => {
    const r = describePain("My left knee is about a 4. Actually it's my right knee.");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "knee", side: "R", score: 4 });
  });

  it("a side correction moves the place", () => {
    const r = describePain("left shoulder pinches on bench, I mean the right one", { exercises: workout });
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "shoulder", side: "R", exerciseName: "Competition Bench Press" });
  });

  it("'not the left, the right'", () => {
    const r = describePain("my knee hurts, not the left, the right, maybe a 3");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "knee", side: "R", score: 3 });
  });

  it("a number corrected is the newer number", () => {
    expect(describePain("hip is a 5, actually more like a 7").places[0].score).toBe(7);
  });

  it("'left knee no right knee' in one breath is the right knee", () => {
    const r = describePain("left knee no right knee is sore");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "knee", side: "R", feel: ["sore"] });
  });
});

describe("a place that isn't hurting is never added", () => {
  it("'is fine' / 'doesn't hurt'", () => {
    const r = describePain("my knee is fine but my left hip is a 4");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "hip_groin", side: "L", score: 4 });
    expect(describePain("my shoulder doesn't hurt anymore").places).toEqual([]);
  });

  it("'doesn't hurt at rest but hurts on squats' is still the knee, during squats", () => {
    const r = describePain("my right knee doesn't hurt at rest but it hurts on squats", { exercises: workout });
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "knee", side: "R", exerciseName: "Competition Squat" });
    expect(r.places[0].timing).not.toContain("rest");
  });

  it("'both knees hurt, the left is fine now' keeps the right", () => {
    const r = describePain("both knees hurt. the left is fine now, the right is a 5");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "knee", side: "R", score: 5 });
  });
});

describe("how bad", () => {
  it("a range is the higher number", () => {
    expect(describePain("knee is like a 3 or 4").places[0].score).toBe(4);
    expect(describePain("knee 6-7 out of 10").places[0].score).toBe(7);
    expect(describePain("knee is five out of ten").places[0].score).toBe(5);
  });

  it("the scale itself is never the rating", () => {
    expect(describePain("on a scale of 1 to 10 my elbow is a 3").places[0].score).toBe(3);
    expect(describePain("on a scale of 1 to 10 my elbow hurts").places[0].score).toBeNull();
  });

  it("'pain level 6'", () => {
    expect(describePain("left wrist, pain level 6").places[0]).toMatchObject({ side: "L", score: 6 });
  });
});

describe("lifting words", () => {
  it("variations find the workout's own lift", () => {
    expect(describePain("low back on sumo", { exercises: workout }).places[0].exerciseName).toBe("Sumo Deadlift");
    expect(describePain("knees on the hack squat", { exercises: workout }).places[0].exerciseName).toBe("Hack Squat");
    expect(describePain("shoulder pinches on larsens", { exercises: workout }).places[0].exerciseName).toBe("Competition Bench Press");
  });

  it("where in the lift is during it", () => {
    expect(describePain("left hip pinches in the hole").places[0].timing).toEqual(["during"]);
    expect(describePain("low back hurts off the floor").places[0].timing).toEqual(["during"]);
    expect(describePain("elbow hurts when i unrack").places[0].timing).toEqual(["during"]);
  });

  it("'left and right' is both", () => {
    expect(describePain("left and right elbow ache").places.map((p) => p.side).sort()).toEqual(["L", "R"]);
  });
});

describe("the anatomy the map names", () => {
  it("anatomical names land on their spot", () => {
    expect(describePain("my left sartorius").places[0]).toMatchObject({ region: "quad", site: "sartorius", side: "L" });
    expect(describePain("infraspinatus on the right is tight").places[0]).toMatchObject({ region: "shoulder", site: "infraspinatus", side: "R" });
    expect(describePain("medial knee pain on the left").places[0]).toMatchObject({ region: "knee", site: "knee_inner", side: "L" });
    expect(describePain("right biceps femoris").places[0]).toMatchObject({ region: "hamstring", site: "hamstring_outer" });
    expect(describePain("the back of my neck is stiff").places[0]).toMatchObject({ region: "neck", site: "neck_back", feel: ["tight"] });
  });

  it("a word that's a whole region stays the region", () => {
    expect(describePain("my calf").places[0]).toMatchObject({ region: "calf", site: null });
    expect(describePain("my quad").places[0]).toMatchObject({ region: "quad", site: null });
  });

  it("'my spine' asks which part", () => {
    expect(describePain("my spine hurts").unclear[0].word).toBe("spine");
  });
});

describe("one issue said twice is one place", () => {
  it("a region and the spot in it", () => {
    const r = describePain("my left knee hurts, right below the kneecap, about a 4");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "knee", site: "patellar_tendon", side: "L", score: 4 });
  });

  it("the neck said three ways is one neck", () => {
    const r = describePain("My neck is tight. The back of my neck mostly. Neck is about a 3.");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "neck", site: "neck_back", score: 3, feel: ["tight"] });
  });

  it("different symptoms stay apart", () => {
    const r = describePain("my shoulder pinches on bench and my rear delt is sore", { exercises: workout });
    expect(r.places).toHaveLength(2);
  });

  it("different sides stay apart", () => {
    const r = reconcilePlaces([
      { region: "knee", site: null, side: "L", score: 4, feel: [], timing: [], exerciseName: null, exerciseId: null, impact: null, change: null, note: "", needs: [] },
      { region: "knee", site: "patellar_tendon", side: "R", score: null, feel: [], timing: [], exerciseName: null, exerciseId: null, impact: null, change: null, note: "", needs: [] },
    ]);
    expect(r).toHaveLength(2);
  });
});

describe("said about nothing named", () => {
  it("comes back as a detail for a place they already have", () => {
    const r = describePain("it's sharp, about a 6, on squats", { exercises: workout });
    expect(r.places).toEqual([]);
    expect(r.detail).toMatchObject({ score: 6, feel: ["sharp"], exerciseName: "Competition Squat" });
  });
});

describe("the brief's examples", () => {
  it("multiple areas in one recording", () => {
    const r = describePain(
      "So my left knee's been sore during squats, I'd say a 4 out of 10. And my lower back got tight on deadlifts, maybe a 3. Right elbow is kind of achy after bench too.",
      { exercises: workout },
    );
    expect(r.places).toHaveLength(3);
    expect(find(r, "knee", "L")).toMatchObject({ score: 4, feel: ["sore"], exerciseName: "Competition Squat" });
    expect(find(r, "low_back", null)).toMatchObject({ score: 3, feel: ["tight"], exerciseName: "Sumo Deadlift" });
    expect(find(r, "elbow", "R")).toMatchObject({ score: null, feel: ["ache"], timing: ["after"] });
  });
});

describe("'right' the side", () => {
  it("is a side after 'the' or 'my', never 'right now' or 'right below'", () => {
    expect(describePain("knee pain on the right after squats").places[0].side).toBe("R");
    expect(describePain("my knee is sore right now").places[0].side).toBeNull();
    expect(describePain("my left knee, right below the kneecap").places[0]).toMatchObject({ side: "L", site: "patellar_tendon" });
  });
});
