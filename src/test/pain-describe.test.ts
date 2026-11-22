import { describe, expect, it } from "vitest";
import { chooseSide, describePain, describedGroups, groundedPlaces, SITE_MIDLINE } from "@/lib/pain/describe";
import { PAIN_SITES } from "@/lib/pain/sites";
import { PAIN_REGIONS } from "@/lib/pain/regions";

const workout = [
  { id: "ex-squat", name: "Competition Squat" },
  { id: "ex-bench", name: "Competition Bench Press" },
  { id: "ex-row", name: "Chest Supported Row" },
];

const find = (r: ReturnType<typeof describePain>, region: string, side: string | null, site: string | null = null) =>
  r.places.find((p) => p.region === region && p.side === side && p.site === site);

describe("describePain: the brief's example", () => {
  const r = describePain(
    "Both knees have been bothering me during squats. The left is about a 5 and the right is a 3. My right shoulder also pinches during bench.",
    { exercises: workout },
  );

  it("finds three places, the knees on their own sides", () => {
    expect(r.places).toHaveLength(3);
    expect(find(r, "knee", "L")).toBeTruthy();
    expect(find(r, "knee", "R")).toBeTruthy();
    expect(find(r, "shoulder", "R")).toBeTruthy();
  });

  it("keeps each side's own rating", () => {
    expect(find(r, "knee", "L")!.score).toBe(5);
    expect(find(r, "knee", "R")!.score).toBe(3);
  });

  it("reads the exercise as their own workout's", () => {
    expect(find(r, "knee", "L")!.exerciseName).toBe("Competition Squat");
    expect(find(r, "knee", "L")!.exerciseId).toBe("ex-squat");
    expect(find(r, "shoulder", "R")!.exerciseName).toBe("Competition Bench Press");
    expect(find(r, "knee", "R")!.timing).toEqual(["during"]);
  });

  it("keeps the shoulder the whole shoulder (never a guessed muscle) and asks only how bad", () => {
    const s = find(r, "shoulder", "R")!;
    expect(s.site).toBeNull();
    expect(s.feel).toEqual(["pinch"]);
    expect(s.score).toBeNull();
    expect(s.needs).toEqual(["score"]);
    expect(find(r, "knee", "L")!.needs).toEqual([]);
  });

  it("keeps their words with each place", () => {
    expect(find(r, "shoulder", "R")!.note).toMatch(/pinches during bench/);
    expect(find(r, "knee", "R")!.note).toMatch(/right is a 3/);
  });
});

describe("describePain: sides", () => {
  it("a plural is both sides", () => {
    const r = describePain("my elbows ache");
    expect(r.places.map((p) => p.side).sort()).toEqual(["L", "R"]);
    expect(r.places.every((p) => p.feel.includes("ache"))).toBe(true);
  });

  it("one score for both sides goes to both", () => {
    const r = describePain("both hamstrings are tight, about a 4");
    expect(r.places).toHaveLength(2);
    expect(r.places.every((p) => p.score === 4)).toBe(true);
  });

  it("a side said after the place counts when it's the only place", () => {
    const r = describePain("knee pain on the left, 6/10");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "knee", side: "L", score: 6 });
  });

  it("no side said: asks which", () => {
    const r = describePain("my knee hurts, maybe a 2");
    expect(r.places[0]).toMatchObject({ region: "knee", side: null, score: 2 });
    expect(r.places[0].needs).toEqual(["side"]);
  });

  it("a later sentence can say the side", () => {
    const r = describePain("my knee hurts. the left one is a 5");
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "knee", side: "L", score: 5 });
  });

  it("two places in one breath keep their own sides", () => {
    const r = describePain("left wrist and right elbow are sore");
    expect(find(r, "wrist_hand", "L")).toBeTruthy();
    expect(find(r, "elbow", "R")).toBeTruthy();
  });

  it("a midline place takes a side only when it leans (low back yes, abs no)", () => {
    expect(describePain("left side of my low back")).toMatchObject({ places: [{ region: "low_back", side: "L" }] });
    expect(describePain("my left abs")).toMatchObject({ places: [{ region: "abs", side: null }] });
    expect(describePain("my low back")).toMatchObject({ places: [{ region: "low_back", side: null, needs: ["score"] }] });
  });

  it("'right' as in right now is no side", () => {
    expect(describePain("my knee is sore right now")).toMatchObject({ places: [{ side: null }] });
  });
});

describe("describePain: spots only when named", () => {
  it("names the spot they named", () => {
    expect(describePain("left patellar tendon, a 4")).toMatchObject({ places: [{ region: "knee", site: "patellar_tendon", side: "L", score: 4 }] });
    expect(describePain("tennis elbow on my right arm")).toMatchObject({ places: [{ region: "elbow", site: "elbow_outer", side: "R" }] });
    expect(describePain("my right bicep")).toMatchObject({ places: [{ region: "upper_arm", site: "biceps", side: "R" }] });
    expect(describePain("rear delt")).toMatchObject({ places: [{ region: "shoulder", site: "rear_delt" }] });
  });

  it("a word that could be several spots stays the region", () => {
    expect(describePain("my rotator cuff is sore")).toMatchObject({ places: [{ region: "shoulder", site: null }] });
    expect(describePain("calf cramps")).toMatchObject({ places: [{ region: "calf", site: null }] });
    expect(describePain("forearm is burning")).toMatchObject({ places: [{ region: "elbow", site: null, feel: ["burning"] }] });
  });

  it("asks which part for 'my back', never guesses", () => {
    const r = describePain("my back is killing me");
    expect(r.places).toEqual([]);
    expect(r.unclear).toEqual([{ word: "back", options: ["upper_back", "mid_back", "low_back", "shoulder_blade"] }]);
  });

  it("'back squat' is an exercise, not a place to ask about", () => {
    const r = describePain("knees hurt on back squats", { exercises: workout });
    expect(r.unclear).toEqual([]);
    expect(r.places[0].exerciseName).toBe("Competition Squat");
  });
});

describe("describePain: numbers", () => {
  it("never reads a weight, sets or days as a rating", () => {
    expect(describePain("my knee hurt on the 3 sets at 225")).toMatchObject({ places: [{ score: null }] });
    expect(describePain("shoulder has been bad for 2 weeks")).toMatchObject({ places: [{ score: null }] });
    expect(describePain("hip is a 7 out of 10")).toMatchObject({ places: [{ score: 7 }] });
    expect(describePain("elbow is about a five")).toMatchObject({ places: [{ score: 5 }] });
    expect(describePain("ankle 8/10")).toMatchObject({ places: [{ score: 8 }] });
  });
});

describe("describePain: the rest of what they said", () => {
  it("when it hurts, what it feels like, what it did to the session", () => {
    const r = describePain("sharp pain in my right hip during deadlifts, had to stop", { exercises: workout });
    expect(r.places[0]).toMatchObject({ region: "hip_groin", side: "R", feel: ["sharp"], timing: ["during"], impact: "stopped", exerciseName: "Deadlifts", exerciseId: null });
  });

  it("after training, at rest, movements", () => {
    expect(describePain("knees ache after squats")).toMatchObject({ places: [{ timing: ["after"] }, { timing: ["after"] }] });
    expect(describePain("neck is stiff in the morning")).toMatchObject({ places: [{ timing: ["rest"], feel: ["tight"] }] });
    expect(describePain("shoulder hurts when i reach overhead")).toMatchObject({ places: [{ timing: ["movement"] }] });
  });

  it("warning words come through so the safety notice can show", () => {
    expect(describePain("felt a pop in my left knee and it's swollen").places[0].feel.sort()).toEqual(["pop", "swollen"]);
    expect(describePain("tingling down my right arm from the neck").places[0].feel).toContain("numb");
  });

  it("an exercise named before the place still belongs to it", () => {
    const r = describePain("During bench, my left shoulder pinches", { exercises: workout });
    expect(r.places[0]).toMatchObject({ region: "shoulder", side: "L", exerciseName: "Competition Bench Press" });
  });

  it("'getting worse' is kept for the follow-up question", () => {
    expect(describePain("right knee is getting worse").places[0].change).toBe("worse");
  });

  it("nothing it can read: nothing made up", () => {
    expect(describePain("felt off today honestly")).toEqual({ places: [], unclear: [] });
    expect(describePain("")).toEqual({ places: [], unclear: [] });
  });
});

describe("describePain: every place it can name is a real one", () => {
  it("midline spots match sites.ts", () => {
    expect([...SITE_MIDLINE].sort()).toEqual(PAIN_SITES.filter((s) => s.midline).map((s) => s.key).sort());
  });

  it("regions and spots it names exist, and each spot is in its region", () => {
    const regions = new Set(PAIN_REGIONS.map((r) => r.key));
    const samples = [
      "between my shoulder blades", "inside of my knee", "above the kneecap", "golfer's elbow", "front delt", "side delt", "ac joint",
      "triceps", "lats", "upper traps", "lower trap", "rhomboid", "si joint", "tailbone", "ql", "obliques", "hip flexor", "tfl",
      "adductor", "piriformis", "glute med", "it band", "vmo", "high hamstring", "shin splints", "achilles", "heel", "plantar fascia",
      "thumb", "sternum", "neck", "chest", "upper arm", "wrist", "abs", "groin", "glute", "quad", "hamstring", "shin", "calf", "ankle",
      "mid back", "low back", "upper back", "shoulder blade",
    ];
    for (const s of samples) {
      const r = describePain(s);
      expect(r.places.length, s).toBeGreaterThan(0);
      for (const p of r.places) {
        expect(regions.has(p.region), s).toBe(true);
        if (p.site) expect(PAIN_SITES.find((x) => x.key === p.site)?.region, s).toBe(p.region);
      }
    }
  });
});


describe("the confirm list", () => {
  it("both sides of a spot are one row", () => {
    const g = describedGroups(describePain("both knees ache, left is a 5 and right is a 3. my neck is tight").places);
    expect(g.map((x) => [x.region, x.choice, x.sided])).toEqual([["knee", "both", true], ["neck", null, false]]);
  });

  it("choosing a side keeps each side's own rating, or copies what was said to both", () => {
    const [knees] = describedGroups(describePain("both knees ache, left is a 5 and right is a 3").places);
    expect(chooseSide(knees, "R").map((p) => [p.side, p.score])).toEqual([["R", 3]]);
    const [hip] = describedGroups(describePain("my hip is a 4, sharp").places);
    const both = chooseSide(hip, "both");
    expect(both.map((p) => [p.side, p.score, p.feel])).toEqual([["L", 4, ["sharp"]], ["R", 4, ["sharp"]]]);
    expect(both.every((p) => p.needs.length === 0)).toBe(true);
  });
});

describe("the server reader's answer is checked against their words", () => {
  const sites = PAIN_SITES;
  it("drops a number, an exercise or a spot it made up", () => {
    const raw = { places: [{ region: "knee", site: "biceps", side: "L", score: 7, feel: ["sharp", "made-up"], timing: ["during"], exercise: "bench press", impact: null, words: "left knee feels off" }] };
    const r = groundedPlaces(raw, "my left knee feels off when I squat", { sites, exercises: [{ id: "x", name: "Competition Squat" }] });
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ region: "knee", site: null, side: "L", score: null, feel: ["sharp"], exerciseName: null, note: "left knee feels off" });
  });

  it("keeps what they did say, both sides included", () => {
    const raw = { places: [{ region: "shoulder", site: null, side: "both", score: 4, feel: [], timing: [], exercise: "overhead press", words: "invented words" }], unclear: ["back", "spleen"] };
    const r = groundedPlaces(raw, "shoulders are about a 4 on overhead press", { sites, exercises: [] });
    expect(r.places.map((p) => [p.side, p.score, p.exerciseName])).toEqual([["L", 4, "Overhead press"], ["R", 4, "Overhead press"]]);
    expect(r.places[0].note).toBe("shoulders are about a 4 on overhead press");
    expect(r.unclear.map((u) => u.word)).toEqual(["back"]);
  });

  it("an unknown region or 'other' is never a place", () => {
    expect(groundedPlaces({ places: [{ region: "spleen" }, { region: "other" }] }, "x y z", { sites }).places).toEqual([]);
    expect(groundedPlaces(null, "x", { sites }).places).toEqual([]);
  });
});
