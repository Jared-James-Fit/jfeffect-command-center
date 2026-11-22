import { describe, expect, it } from "vitest";
import { normalizeAllRow, normalizeMeetRow, partsOf, type StrengthRow } from "@/lib/strength-board";
import {
  TYPICAL_SPLIT,
  compareLifters,
  deviations,
  glOf,
  hallSplits,
  lifterFor,
  liftProfile,
  liftRatios,
  pct,
  profileLine,
  repsNote,
  splitOf,
  standoutShares,
  typicalAround,
} from "@/lib/strength-split";
import { glPoints } from "@/lib/gl-points";

/** A board's rows for one person: their three lifts and the total those lifts make (training unless `meet`). */
function person(key: string, name: string, sex: "male" | "female" | null, s: number, b: number, d: number, opts: { bw?: number; reps?: [number, number, number]; meet?: boolean; gl?: number; is_me?: boolean } = {}): StrengthRow[] {
  const bw = opts.bw ?? null;
  const reps = opts.reps ?? [1, 1, 1];
  const base = { person: key, client_id: key, display_name: name, sex, is_me: !!opts.is_me, source: opts.meet ? "meet" : "training", lifted_on: "2026-10-01", bw_kg: bw, all_rank: 1 };
  const lift = (l: string, kg: number, r: number) => normalizeAllRow({ ...base, lift: l, kg, reps: opts.meet ? null : r, bw_multiple: bw ? Math.round((kg / bw) * 100) / 100 : null });
  return [
    lift("squat", s, reps[0]),
    lift("bench", b, reps[1]),
    lift("deadlift", d, reps[2]),
    normalizeAllRow({
      ...base, lift: "total", kg: s + b + d, reps: null, bw_multiple: bw ? Math.round(((s + b + d) / bw) * 100) / 100 : null,
      squat_kg: s, bench_kg: b, deadlift_kg: d, squat_reps: opts.meet ? null : reps[0], bench_reps: opts.meet ? null : reps[1], deadlift_reps: opts.meet ? null : reps[2],
      gl_points: opts.gl ?? null,
    }),
  ];
}

describe("the total's parts come off the board row", () => {
  it("reads a total's squat, bench and deadlift with their reps; nothing on a single lift or an older board", () => {
    expect(partsOf({ lift: "total", squat_kg: "270", bench_kg: 180, deadlift_kg: 292.5, squat_reps: 1, bench_reps: 3, deadlift_reps: null })).toEqual({
      squat: 270, bench: 180, deadlift: 292.5, reps: { squat: 1, bench: 3, deadlift: 1 },
    });
    expect(partsOf({ lift: "squat", squat_kg: 270, bench_kg: 180, deadlift_kg: 292.5 })).toBeNull();
    expect(partsOf({ lift: "total" })).toBeNull();
    // the meets board sends the meet's parts too
    const m = normalizeMeetRow({ athlete_id: "a1", lift: "total", kg: 401, squat_kg: 145, bench_kg: 88, deadlift_kg: 168, gl_points: 87.73 });
    expect(m.parts?.reps).toEqual({ squat: 1, bench: 1, deadlift: 1 });
    expect(m.gl_points).toBeCloseTo(87.73);
  });
});

describe("the split", () => {
  it("adds up to the total on the board, shares sum to 1", () => {
    const [, , , total] = person("c:1", "Ali K", "male", 270, 180, 292.5, { bw: 93 });
    const split = splitOf(total)!;
    expect(split.total).toBe(total.kg);
    expect(split.share.squat + split.share.bench + split.share.deadlift).toBeCloseTo(1, 10);
    expect(pct(split.share.squat)).toBe("36.4%");
    expect(split.singles).toBe(true);
  });

  it("the typical splits are the published averages and each sums to 100%", () => {
    for (const sex of ["male", "female"] as const) {
      const t = TYPICAL_SPLIT[sex];
      expect(t.squat + t.bench + t.deadlift).toBeCloseTo(1, 10);
    }
    expect(TYPICAL_SPLIT.male).toEqual({ squat: 0.35, bench: 0.24, deadlift: 0.41 });
    expect(TYPICAL_SPLIT.female).toEqual({ squat: 0.355, bench: 0.205, deadlift: 0.44 });
  });

  it("a set of reps is said, never passed off as a max", () => {
    const [, , , total] = person("c:2", "Bo L", "male", 161, 95, 185, { reps: [4, 5, 3] });
    const split = splitOf(total)!;
    expect(split.singles).toBe(false);
    expect(repsNote(split)).toBe("squat ×4, bench ×5, deadlift ×3");
  });
});

describe("profiles against a typical lifter", () => {
  it("a typical man's split is an all-rounder", () => {
    const [, , , total] = person("c:3", "Cy M", "male", 350, 240, 410);
    const p = liftProfile(splitOf(total)!, "male")!;
    expect(p.key).toBe("balanced");
    expect(profileLine(p, splitOf(total)!, "male")).toContain("Every lift within 2 points");
  });

  it("a squat-heavy man is a Squatter; the line names the share and typical", () => {
    // 265 / 159 / 277: squat 37.9%, bench 22.7%
    const [, , , total] = person("c:4", "Dee N", "male", 265, 159, 277);
    const split = splitOf(total)!;
    const p = liftProfile(split, "male")!;
    expect(p.key).toBe("squatter");
    expect(p.lead).toBe("squat");
    expect(profileLine(p, split, "male")).toBe("Squat is 37.8% of the total; a typical man's is 35%.");
  });

  it("a woman's split is read against women's numbers, never men's", () => {
    // 140 / 65 / 160 (a real meet in the Hall): bench 17.8%, deadlift 43.8%
    const [, , , total] = person("a:5", "Eve O", "female", 140, 65, 160, { meet: true });
    const split = splitOf(total)!;
    const dev = deviations(split, "female");
    expect(dev.bench).toBeLessThan(-2);
    const p = liftProfile(split, "female")!;
    expect(p.lag).toBe("bench");
    // against men's numbers it would look far more bench-light
    expect(deviations(split, "male").bench).toBeLessThan(dev.bench);
  });

  it("one lift lagging with nothing clearly over: named by the two that carry it", () => {
    // squat 36.6 (+1.6), bench 21.5 (−2.5), deadlift 41.9 (+0.9)
    const split = splitOf(person("c:6", "Fi P", "male", 366, 215, 419)[3])!;
    const p = liftProfile(split, "male")!;
    expect(p.key).toBe("legs");
    expect(p.title).toBe("Leg-dominant");
    expect(profileLine(p, split, "male")).toBe("Bench is 21.5% of the total; a typical man's is 24%. The squat and deadlift carry the rest.");
  });

  it("no sex, no reference: no profile (never a man's numbers by default)", () => {
    expect(liftProfile(splitOf(person("c:7", "Gus Q", null, 134, 84, 166)[3])!, null)).toBeNull();
  });

  it("ratios and the lagging lift at a typical share, holding the other two", () => {
    const split = splitOf(person("c:8", "Hal R", "male", 270, 160, 293)[3])!;
    const r = liftRatios(split, "male");
    expect(r[0].value).toBeCloseTo(160 / 270);
    expect(r[0].typical).toBeCloseTo(0.24 / 0.35);
    // bench at 24% of (bench + 563): 0.24 × 563 / 0.76
    expect(typicalAround(split, "male", "bench")).toBeCloseTo((0.24 * 563) / 0.76, 6);
  });
});

describe("GL points", () => {
  it("the formula matches a real meet's official points", () => {
    // 401 kg total at 63 kg bodyweight, classic, official 87.7 GL
    expect(glPoints(401, 63, "F")).toBeCloseTo(87.73, 1);
  });
  it("a meet total uses its official points; a gym total is an estimate from the formula; no sex, none", () => {
    const meet = person("a:9", "Ida S", "female", 145, 88, 168, { meet: true, bw: 63, gl: 87.7 })[3];
    expect(glOf(meet)).toEqual({ value: 87.7, estimate: false });
    const gym = person("c:10", "Jo T", "male", 270, 180, 293, { bw: 93 })[3];
    expect(glOf(gym)?.estimate).toBe(true);
    expect(glOf(gym)?.value).toBeCloseTo(glPoints(743, 93, "M")!, 6);
    expect(glOf(person("c:11", "Kai U", null, 134, 84, 166, { bw: 84 })[3])).toBeNull();
  });
});

describe("the Hall's own numbers", () => {
  const rows = [
    ...person("c:a", "Al A", "male", 270, 180, 293, { bw: 93 }),
    ...person("c:b", "Ben B", "male", 265, 159, 277, { bw: 91 }),
    ...person("c:c", "Cal C", "male", 243, 153, 270, { bw: 71 }),
    ...person("c:d", "Dan D", "male", 260, 170, 290, { bw: 73 }),
    ...person("c:e", "Ed E", "male", 255, 185, 273, { bw: 123 }),
    ...person("c:f", "Flo F", "female", 145, 88, 168, { bw: 63 }),
  ];
  it("averages per sex and flags only first or last of 5+", () => {
    const hall = hallSplits(rows);
    expect(hall.people).toHaveLength(6);
    expect(hall.average.male?.count).toBe(5);
    expect(hall.average.female?.count).toBe(1);
    // Ed's 185 bench is the biggest bench share of the 5 men
    const ed = standoutShares(hall, "c:e");
    expect(ed).toContainEqual({ lift: "bench", rank: 1, of: 5, top: true });
    // one woman: never ranked
    expect(standoutShares(hall, "c:f")).toEqual([]);
  });

  it("head to head: the gap between totals adds up lift by lift, and who's stronger for their size", () => {
    const hall = hallSplits(rows);
    // Dan (73 kg) vs Ed (123 kg): Ed out-benches, Dan out-squats and out-pulls
    const dan = lifterFor(rows, "c:d")!;
    const ed = lifterFor(rows, "c:e")!;
    const c = compareLifters(dan, ed, "kg", hall);
    expect(c.gap!.total).toBeCloseTo(720 - 713);
    expect(c.gap!.parts.reduce((n, p) => n + p.kg, 0)).toBeCloseTo(c.gap!.total, 6);
    expect(c.lines[0]).toBe("Dan out-totals Ed by 7 kg. The deadlift alone is 17 kg.");
    expect(c.lines[1]).toBe("Ed wins back the bench by 15 kg.");
    // Dan lifts more at 50 kg lighter: he leads on GL too
    expect(c.lines.some((l) => l.startsWith("Pound for pound, Dan leads too:"))).toBe(true);
    expect(c.lines.some((l) => l.includes("Ed weighs 50 kg more (123 kg to 73 kg)."))).toBe(true);
    expect(c.headline).toBe("Dan: squat + deadlift · Ed: bench");
    expect(c.unique.b.some((l) => l.startsWith("The bench carries"))).toBe(true);
    // each profile once, short: never the same percentage twice
    expect(c.unique.b).toContain("Squat & bench: deadlift 2.7 points under a typical man's share.");
  });

  it("speaks to you as you", () => {
    const mine = rows.map((r) => (r.key === "c:c" ? { ...r, is_me: true } : r));
    const me = lifterFor(mine, "c:c")!;
    const al = lifterFor(mine, "c:a")!;
    const c = compareLifters(me, al, "kg", hallSplits(mine));
    // Al totals 77 kg more, but at 22 kg lighter you're stronger for your size
    expect(c.lines[0]).toMatch(/^Al out-totals you by 77 kg\./);
    expect(c.lines.some((l) => /^Al lifts more, but you are stronger for your size: \d+\.\d GL to \d+\.\d \(a gym total's GL is an estimate\)\.$/.test(l))).toBe(true);
    // never a capital "You" mid-sentence
    expect(c.lines.join(" ")).not.toMatch(/[a-z,] You\b/);
  });

  it("a man and a woman: the note says GL is the fair comparison", () => {
    const c = compareLifters(lifterFor(rows, "c:a")!, lifterFor(rows, "c:f")!, "lb");
    expect(c.notes.some((n) => n.includes("GL points are the fair comparison"))).toBe(true);
  });

  it("a total built on rep sets never sets the Hall's average or wins a standout", () => {
    const more = [...rows, ...person("c:g", "Gil G", "male", 70, 127, 143, { reps: [6, 5, 4], bw: 83 })];
    const hall = hallSplits(more);
    expect(hall.average.male?.count).toBe(5);
    expect(standoutShares(hall, "c:g")).toEqual([]);
    // Ed keeps the biggest bench share (Gil's 37% bench is a ×5 next to a ×6 squat)
    expect(standoutShares(hall, "c:e")).toContainEqual({ lift: "bench", rank: 1, of: 5, top: true });
  });

  it("totals done for reps get a note", () => {
    const more = [...rows, ...person("c:g", "Gil G", "male", 161, 95, 185, { reps: [4, 5, 3], bw: 68 })];
    const c = compareLifters(lifterFor(more, "c:g")!, lifterFor(more, "c:a")!, "kg");
    expect(c.notes[0]).toBe("Gil's total includes squat ×4, bench ×5, deadlift ×3: done for reps, so those lifts read light next to singles.");
  });
});
