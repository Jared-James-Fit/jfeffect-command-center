/**
 * The competitive landscape (pure, tested): our athlete's range against every
 * competitor's, who the real threat is and why, what total wins, podiums and
 * qualifies, where we're stronger and weaker, and the strategic questions a
 * head coach asks, each answered from the numbers. Ranges overlap more often
 * than not: the read says so instead of pretending a forecast is a result.
 */
import type { CompetitorRead } from "./competitor";
import { roundTo } from "./rules";
import type { Lift, Objective, Range } from "./types";

export type CompetitorEntry = {
  id: string;
  name: string;
  read: CompetitorRead;
  /** suggested: found by research (likely, not a confirmed entry) */
  status?: "suggested" | "confirmed" | "registered";
};

export type Threat = {
  id: string;
  name: string;
  expected: number;
  range: Range;
  /** their range reaches into ours */
  overlaps: boolean;
  level: "favourite" | "contender" | "outside";
  why: string[];
  status: "suggested" | "confirmed" | "registered";
};

export type Landscape = {
  ranked: Threat[];
  biggest: Threat | null;
  /** the expected total that wins / takes 3rd (null: not enough competitors on file) */
  toWin: number | null;
  toPodium: number | null;
  /** places by expected totals, and the best / worst the ranges allow */
  place: { expected: number; best: number; worst: number } | null;
  qualification: { needed: number; gapExpected: number; reachableConservative: boolean } | null;
  subtotal: { ours: number | null; theirs: number | null; deadliftGap: number | null } | null;
  answers: Array<{ q: string; a: string }>;
  /** the athlete's expected is well over anything they've made: worth checking */
  overestimate: string | null;
};

export function buildLandscape(input: {
  athlete: {
    total: Range | null;
    lifts: Record<Lift, Range | null>;
    bestMeetTotal: number | null;
    confidence: "high" | "medium" | "low";
  };
  competitors: CompetitorEntry[];
  objective: Objective | null;
  qualificationTotal?: number | null;
  targetPlace?: number | null;
  increment?: number;
}): Landscape {
  const step = input.increment ?? 2.5;
  const us = input.athlete.total;
  const projected = input.competitors
    .filter((c) => c.read.projection)
    .map((c) => ({ ...c, p: c.read.projection! }));
  const ranked: Threat[] = projected
    .sort((a, b) => b.p.expected - a.p.expected)
    .map((c) => {
      const overlaps = !!us && c.p.high >= us.conservative && c.p.conservative <= us.high;
      const why: string[] = [];
      if (c.read.recentTotal)
        why.push(`Last total ${c.read.recentTotal.kg} kg (${c.read.recentTotal.date})`);
      if (c.read.trendPerYear != null && Math.abs(c.read.trendPerYear) >= 5)
        why.push(
          `${c.read.trendPerYear > 0 ? "Rising" : "Falling"} ${Math.abs(c.read.trendPerYear)} kg a year`,
        );
      if (c.read.stats.success[2] != null && c.read.stats.meetsWithAttempts >= 2)
        why.push(`Makes ${Math.round(c.read.stats.success[2] * 100)}% of thirds`);
      if (c.read.stats.bombOuts)
        why.push(
          `No total at ${c.read.stats.bombOuts} meet${c.read.stats.bombOuts === 1 ? "" : "s"}`,
        );
      const moved = Object.values(c.read.training).filter((t) => t && t.weight >= 0.2);
      if (moved.length) {
        const up = moved.filter((t) => {
          const last = c.read.lastSplit[t!.lift];
          return last != null && t!.estimateKg > last;
        }).length;
        why.push(
          up >= moved.length / 2
            ? "A run of recent training points above their meets"
            : "Recent training points below their meets",
        );
      } else if (c.read.observationsUsed.length)
        why.push("A recent training lift widens their high end");
      if (c.status === "suggested") why.push("Likely entrant from rankings, not a confirmed entry");
      const level: Threat["level"] = !us
        ? "contender"
        : c.p.expected > us.high
          ? "favourite"
          : overlaps
            ? "contender"
            : "outside";
      return {
        id: c.id,
        name: c.name,
        expected: c.p.expected,
        range: { conservative: c.p.conservative, expected: c.p.expected, high: c.p.high },
        overlaps,
        level,
        why,
        status: c.status ?? "confirmed",
      };
    });

  // the biggest threat: the strongest competitor whose range reaches ours (or the strongest overall)
  const biggest = ranked.find((t) => t.overlaps || t.level === "favourite") ?? ranked[0] ?? null;
  const toWin = ranked.length ? roundTo(ranked[0].expected + step, step) : null;
  const toPodium =
    ranked.length >= 3 ? roundTo(ranked[2].expected + step, step) : ranked.length ? 0 : null;

  let place: Landscape["place"] = null;
  if (us && ranked.length) {
    const expected = 1 + ranked.filter((t) => t.expected > us.expected).length;
    const best = 1 + ranked.filter((t) => t.range.conservative > us.high).length;
    const worst = 1 + ranked.filter((t) => t.range.high > us.conservative).length;
    place = { expected, best, worst };
  }

  const qualification =
    input.qualificationTotal && us
      ? {
          needed: input.qualificationTotal,
          gapExpected: Math.round((us.expected - input.qualificationTotal) * 10) / 10,
          reachableConservative: us.conservative >= input.qualificationTotal,
        }
      : null;

  // subtotal against the biggest threat: what the deadlift has to make up
  let subtotal: Landscape["subtotal"] = null;
  const threatRead = biggest ? projected.find((c) => c.id === biggest.id) : null;
  const ourSB =
    input.athlete.lifts.squat && input.athlete.lifts.bench
      ? input.athlete.lifts.squat.expected + input.athlete.lifts.bench.expected
      : null;
  const theirSB =
    threatRead?.p.lifts.squat && threatRead.p.lifts.bench
      ? threatRead.p.lifts.squat.expected + threatRead.p.lifts.bench.expected
      : null;
  if (ourSB != null || theirSB != null) {
    const ourD = input.athlete.lifts.deadlift?.expected ?? null;
    const theirD = threatRead?.p.lifts.deadlift?.expected ?? null;
    subtotal = {
      ours: ourSB,
      theirs: theirSB,
      deadliftGap:
        ourSB != null && theirSB != null && ourD != null && theirD != null
          ? Math.round((theirSB + theirD - ourSB - ourD) * 10) / 10
          : null,
    };
  }

  const answers: Landscape["answers"] = [];
  if (biggest)
    answers.push({
      q: "Biggest threat",
      a: `${biggest.name}: expected ${biggest.expected} kg (${biggest.range.conservative}–${biggest.range.high}). ${biggest.why.slice(0, 2).join("; ")}`,
    });
  if (toWin != null && ranked.length)
    answers.push({
      q: "Likely needed to win",
      a: `About ${toWin} kg, if the field lifts to its expected totals`,
    });
  if (toPodium) answers.push({ q: "Likely needed to podium", a: `About ${toPodium} kg` });
  if (qualification)
    answers.push({
      q: "Qualifying total",
      a: `${qualification.needed} kg: expected is ${qualification.gapExpected >= 0 ? `${qualification.gapExpected} kg over` : `${-qualification.gapExpected} kg short`}${qualification.reachableConservative ? ", and even the conservative day makes it" : ""}`,
    });
  if (us && place)
    answers.push({
      q: "Projected placing",
      a:
        place.best === place.worst
          ? `${ordinal(place.expected)}`
          : `${ordinal(place.expected)} expected (${ordinal(place.best)} to ${ordinal(place.worst)} across the ranges)`,
    });
  if (subtotal?.ours != null && subtotal.theirs != null) {
    const diff = Math.round((subtotal.ours - subtotal.theirs) * 10) / 10;
    answers.push({
      q: "Squat + bench against the threat",
      a: diff >= 0 ? `${diff} kg ahead after bench` : `${-diff} kg behind after bench`,
    });
    if (diff < 0 && input.athlete.lifts.deadlift && threatRead?.p.lifts.deadlift) {
      const can = input.athlete.lifts.deadlift.expected - threatRead.p.lifts.deadlift.expected;
      answers.push({
        q: "Can the deadlift close it",
        a:
          can >= -diff
            ? `Yes on expected numbers: ${Math.round(can * 10) / 10} kg more deadlift than them`
            : `Not on expected numbers: ${Math.round(can * 10) / 10} kg against the ${-diff} kg gap`,
      });
    }
  }
  const overestimate =
    us &&
    input.athlete.bestMeetTotal &&
    us.expected > input.athlete.bestMeetTotal * 1.07 &&
    input.athlete.confidence !== "high"
      ? `Expected ${us.expected} kg is ${Math.round((us.expected / input.athlete.bestMeetTotal - 1) * 100)}% over their best meet (${input.athlete.bestMeetTotal} kg) on evidence that isn't strong: check it before building strategy on it`
      : null;
  if (!ranked.length)
    answers.push({ q: "The field", a: "No competitors on file yet: placing can't be read" });
  else if (ranked.every((t) => t.status === "suggested"))
    answers.push({
      q: "The field",
      a: "Read from public rankings: who's likely there, not a confirmed start list",
    });
  return {
    ranked,
    biggest,
    toWin,
    toPodium,
    place,
    qualification,
    subtotal,
    answers,
    overestimate,
  };
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
