import { describe, expect, it } from "vitest";
import {
  deadliftForPlace,
  deadliftForTotal,
  deadliftToBeat,
  floorAttempt,
  standings,
  type Entrant,
  type LiveAttempt,
} from "@/lib/competition/scenarios";
import { IPF_RULES } from "@/lib/competition/rules";

const a = (...xs: Array<[number, "good" | "no_lift" | "pending"]>): LiveAttempt[] =>
  xs.map(([kg, result]) => ({ kg, result }));

const us: Entrant = {
  id: "us",
  name: "Our athlete",
  us: true,
  bodyweight: 82.1,
  attempts: {
    squat: a([230, "good"], [240, "good"], [247.5, "no_lift"]),
    bench: a([150, "good"], [157.5, "good"], [162.5, "good"]),
    deadlift: a([270, "good"]),
  },
};
const rival: Entrant = {
  id: "r1",
  name: "Rival",
  bodyweight: 82.9,
  attempts: {
    squat: a([235, "good"], [245, "good"], [252.5, "good"]),
    bench: a([145, "good"], [152.5, "good"], [157.5, "no_lift"]),
    deadlift: a([275, "good"], [287.5, "good"], [295, "pending"]),
  },
};
const third: Entrant = {
  id: "r2",
  name: "Third",
  bodyweight: 80,
  attempts: { squat: a([200, "good"]), bench: a([130, "good"]), deadlift: a([250, "good"]) },
};

describe("meet-day calculator", () => {
  it("totals best made lifts and ranks", () => {
    const st = standings([us, rival, third]);
    expect(st.find((s) => s.id === "r1")!.total).toBe(252.5 + 152.5 + 287.5);
    expect(st.find((s) => s.id === "us")!.total).toBe(240 + 162.5 + 270);
    expect(st[0].id).toBe("r1");
    expect(st.find((s) => s.id === "r1")!.ceiling).toBe(252.5 + 152.5 + 295);
  });

  it("works out the deadlift to beat a rival, lighter bodyweight winning a tie", () => {
    // rival on 692.5 now: our subtotal 402.5 → a tie at 290, and we're lighter
    const n = deadliftToBeat({
      entrants: [us, rival, third],
      usId: "us",
      rivalId: "r1",
      rules: IPF_RULES,
      assume: "current",
    });
    expect(n.deadlift).toBe(290);
    expect(n.total).toBe(692.5);
    // assuming they make their declared 295 → 700: 297.5 ties and wins on bodyweight
    const c = deadliftToBeat({
      entrants: [us, rival, third],
      usId: "us",
      rivalId: "r1",
      rules: IPF_RULES,
      assume: "ceiling",
      ourHighDeadlift: 295,
    });
    expect(c.deadlift).toBe(297.5);
    expect(c.possible).toBe(false);
  });

  it("asks one more increment when a tie isn't won (heavier or unknown bodyweight)", () => {
    const heavy = { ...us, bodyweight: 83.5 };
    expect(
      deadliftToBeat({
        entrants: [heavy, rival],
        usId: "us",
        rivalId: "r1",
        rules: IPF_RULES,
        assume: "current",
      }).deadlift,
    ).toBe(292.5);
    const unknown = { ...us, bodyweight: null };
    expect(
      deadliftToBeat({
        entrants: [unknown, rival],
        usId: "us",
        rivalId: "r1",
        rules: IPF_RULES,
        assume: "current",
      }).deadlift,
    ).toBe(292.5);
  });

  it("never asks for less than the last attempt", () => {
    const missed = {
      ...us,
      attempts: { ...us.attempts, deadlift: a([270, "good"], [285, "no_lift"]) },
    };
    expect(floorAttempt(missed.attempts.deadlift, IPF_RULES)).toBe(285);
    const easy = deadliftForTotal({
      entrant: missed,
      target: 650,
      rules: IPF_RULES,
      goal: "Qualify",
    });
    expect(easy.deadlift).toBe(285);
  });

  it("works out a placing and a qualifying total", () => {
    const p2 = deadliftForPlace({
      entrants: [us, rival, third],
      usId: "us",
      place: 2,
      rules: IPF_RULES,
      assume: "current",
    });
    expect(p2.deadlift).toBeLessThanOrEqual(272.5);
    const p1 = deadliftForPlace({
      entrants: [us, rival, third],
      usId: "us",
      place: 1,
      rules: IPF_RULES,
      assume: "current",
    });
    expect(p1.deadlift).toBe(290);
    const q = deadliftForTotal({
      entrant: us,
      target: 700,
      rules: IPF_RULES,
      goal: "Qualify",
      ourHighDeadlift: 300,
    });
    expect(q.deadlift).toBe(297.5);
    expect(q.possible).toBe(true);
  });

  it("a lifter with no made attempt on a finished lift has no total", () => {
    const bombed: Entrant = {
      id: "b",
      name: "Bomb",
      bodyweight: 81,
      attempts: {
        squat: a([250, "no_lift"], [250, "no_lift"], [250, "no_lift"]),
        bench: a([150, "good"]),
        deadlift: a(),
      },
    };
    const st = standings([us, bombed]);
    expect(st.find((s) => s.id === "b")!.bombed).toBe(true);
    expect(st.find((s) => s.id === "b")!.total).toBeNull();
  });
});
