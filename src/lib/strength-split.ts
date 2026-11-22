/**
 * Hall of Strength, the nerd read: what each total is made of and how two
 * lifters differ. Pure and deterministic (no model): every number comes from
 * the board's own rows, and every line says only what those numbers show.
 *
 *  - The split: squat, bench and deadlift as a share of the total, from the
 *    total's own parts (the board's row: a training total's three best lifts
 *    with their reps, a meet total's lifts from that day), so it always adds
 *    up to the total on the board.
 *  - Typical lifters: the average split of raw meet results, men 35 / 24 / 41
 *    and women 35.5 / 20.5 / 44 (Stronger By Science's analysis of
 *    OpenPowerlifting results, "How to Get Strong, Part 2: What is Strong?"),
 *    which OpenPowerlifting's medians of raw full-power lifters agree with
 *    (men: squat 1.5× bench, 85% of deadlift → 35.2 / 23.4 / 41.4; women:
 *    1.8× and 83% → 36.2 / 20.1 / 43.7). Heavier and more elite lifters lean
 *    a little more on the squat (powerliftingindata.com, Nov 2024): said as a
 *    direction, never a number.
 *  - "Leans" means a share at least LEAN_POINTS (2) percentage points from
 *    typical: about one lifter-to-lifter spread on the Hall's own meet
 *    results (women's bench 17–25% of total). That threshold is this app's
 *    reading, not a published standard, and the copy never says otherwise.
 *  - A set of reps counts as lifted, like the board: a ×5 bench reads light
 *    next to singles, so the split says so instead of pretending it's a max.
 *  - GL points: a meet total's official ones, else the IPF formula on a gym
 *    total at its bodyweight, always labelled an estimate.
 */
import { glPoints } from "@/lib/gl-points";
import type { WeightUnit } from "@/lib/weight-lifted";
import { formatLoad, type Sex, type StrengthRow, type TotalParts } from "@/lib/strength-board";

export type SplitLift = "squat" | "bench" | "deadlift";
export const SPLIT_LIFTS: readonly SplitLift[] = ["squat", "bench", "deadlift"];
export const SPLIT_NAME: Record<SplitLift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };

/** Typical raw lifter's split (shares of the total), by sex. Sources in the header. */
export const TYPICAL_SPLIT: Record<Sex, Record<SplitLift, number>> = {
  male: { squat: 0.35, bench: 0.24, deadlift: 0.41 },
  female: { squat: 0.355, bench: 0.205, deadlift: 0.44 },
};

/** Percentage points from typical before a share "leans" one way; STRONG_POINTS reads as strongly. */
export const LEAN_POINTS = 2;
export const STRONG_POINTS = 4.5;

export type TotalSplit = {
  kg: Record<SplitLift, number>;
  reps: Record<SplitLift, number>;
  /** squat + bench + deadlift (the total the shares are of) */
  total: number;
  share: Record<SplitLift, number>;
  /** every part a single (always, for a meet) */
  singles: boolean;
  source: "training" | "meet";
};

/** A total row's split, or null when it isn't a total or the board didn't send its parts. */
export function splitOf(row: Pick<StrengthRow, "lift" | "source"> & { parts?: TotalParts | null }): TotalSplit | null {
  const p = row.lift === "total" ? row.parts : null;
  if (!p) return null;
  const total = p.squat + p.bench + p.deadlift;
  if (!(total > 0)) return null;
  const kg = { squat: p.squat, bench: p.bench, deadlift: p.deadlift };
  const reps = { squat: p.reps.squat, bench: p.reps.bench, deadlift: p.reps.deadlift };
  return {
    kg,
    reps,
    total,
    share: { squat: p.squat / total, bench: p.bench / total, deadlift: p.deadlift / total },
    singles: SPLIT_LIFTS.every((l) => reps[l] <= 1),
    source: row.source,
  };
}

/** 0.3582 → "35.8%" */
export const pct = (share: number, dp = 1) => `${(share * 100).toFixed(dp)}%`;
/** Percentage points between two shares, rounded to a tenth: 0.392 − 0.35 → 4.2 */
export const points = (a: number, b: number) => Math.round((a - b) * 1000) / 10;

/** Each lift's share against a typical lifter's, in percentage points (they sum to ~0). */
export function deviations(split: TotalSplit, sex: Sex): Record<SplitLift, number> {
  const t = TYPICAL_SPLIT[sex];
  return { squat: points(split.share.squat, t.squat), bench: points(split.share.bench, t.bench), deadlift: points(split.share.deadlift, t.deadlift) };
}

export type ProfileKey = "balanced" | "squatter" | "bencher" | "puller" | "legs" | "bench_pull" | "squat_bench";
export type LiftProfile = {
  key: ProfileKey;
  /** "Squatter", "Bencher", "Puller", "Leg-dominant", "All-rounder"… */
  title: string;
  /** how far it leans: none for an all-rounder */
  strength: "none" | "lean" | "strong";
  /** the lift that carries the most extra (null when no one lift does) */
  lead: SplitLift | null;
  /** the lift furthest under typical, when it's at least LEAN_POINTS under */
  lag: SplitLift | null;
  dev: Record<SplitLift, number>;
};

const LEAD_PROFILE: Record<SplitLift, { key: ProfileKey; title: string }> = {
  squat: { key: "squatter", title: "Squatter" },
  bench: { key: "bencher", title: "Bencher" },
  deadlift: { key: "puller", title: "Puller" },
};
/** No one lift carries it, one lags: named by the two that carry the total. */
const LAG_PROFILE: Record<SplitLift, { key: ProfileKey; title: string }> = {
  bench: { key: "legs", title: "Leg-dominant" },
  squat: { key: "bench_pull", title: "Bench & pull" },
  deadlift: { key: "squat_bench", title: "Squat & bench" },
};

/** What their split says about them against a typical lifter of their sex. Null without a sex (no reference). */
export function liftProfile(split: TotalSplit, sex: Sex | null): LiftProfile | null {
  if (!sex) return null;
  const dev = deviations(split, sex);
  const byDev = [...SPLIT_LIFTS].sort((a, b) => dev[b] - dev[a]);
  const top = byDev[0];
  const low = byDev[2];
  const lag = dev[low] <= -LEAN_POINTS ? low : null;
  const strength = dev[top] >= STRONG_POINTS || dev[low] <= -STRONG_POINTS ? "strong" : "lean";
  if (dev[top] >= LEAN_POINTS) return { ...LEAD_PROFILE[top], strength, lead: top, lag, dev };
  if (lag) return { ...LAG_PROFILE[lag], strength, lead: null, lag, dev };
  return { key: "balanced", title: "All-rounder", strength: "none", lead: null, lag: null, dev };
}

const typicalPct = (share: number) => pct(share).replace(".0%", "%");

/** One line for a profile: "Squat is 39.2% of the total; a typical man's is 35%." */
export function profileLine(p: LiftProfile, split: TotalSplit, sex: Sex): string {
  const who = sex === "male" ? "man's" : "woman's";
  const t = TYPICAL_SPLIT[sex];
  if (p.key === "balanced") return `Every lift within ${LEAN_POINTS} points of a typical ${who} split. Nothing carries the total, nothing drags it.`;
  if (p.lead) {
    const lagPart = p.lag ? ` ${SPLIT_NAME[p.lag]} sits ${Math.abs(p.dev[p.lag]).toFixed(1)} points under.` : "";
    return `${SPLIT_NAME[p.lead]} is ${pct(split.share[p.lead])} of the total; a typical ${who} is ${typicalPct(t[p.lead])}.${lagPart}`;
  }
  const lag = p.lag!;
  const rest = SPLIT_LIFTS.filter((l) => l !== lag).map((l) => SPLIT_NAME[l].toLowerCase());
  return `${SPLIT_NAME[lag]} is ${pct(split.share[lag])} of the total; a typical ${who} is ${typicalPct(t[lag])}. The ${rest[0]} and ${rest[1]} carry the rest.`;
}

/** A profile in one short line for the head to head: "Squatter: squat 2.9 points over a typical man's share." */
export function profileShort(p: LiftProfile, sex: Sex): string {
  const who = sex === "male" ? "man's" : "woman's";
  if (p.key === "balanced") return `All-rounder: every lift within ${LEAN_POINTS} points of a typical ${who} split.`;
  const lift = p.lead ?? p.lag!;
  const d = p.dev[lift];
  return `${p.title}: ${SPLIT_NAME[lift].toLowerCase()} ${Math.abs(d).toFixed(1)} points ${d > 0 ? "over" : "under"} a typical ${who} share.`;
}

export type LiftRatio = { key: "bench_squat" | "dead_squat" | "bench_dead"; label: string; value: number; typical: number | null };

/** The classic ratios, with a typical lifter's when the sex is known (from the same split). */
export function liftRatios(split: TotalSplit, sex: Sex | null): LiftRatio[] {
  const t = sex ? TYPICAL_SPLIT[sex] : null;
  const k = split.kg;
  return [
    { key: "bench_squat", label: "Bench ÷ squat", value: k.bench / k.squat, typical: t ? t.bench / t.squat : null },
    { key: "dead_squat", label: "Deadlift ÷ squat", value: k.deadlift / k.squat, typical: t ? t.deadlift / t.squat : null },
    { key: "bench_dead", label: "Bench ÷ deadlift", value: k.bench / k.deadlift, typical: t ? t.bench / t.deadlift : null },
  ];
}

/**
 * The lagging lift at a typical lifter's share, holding the other two where
 * they are: x / (others + x) = typical share. "A typical split around your
 * squat and deadlift has a 178 kg bench." Null when nothing lags.
 */
export function typicalAround(split: TotalSplit, sex: Sex, lift: SplitLift): number {
  const p = TYPICAL_SPLIT[sex][lift];
  const others = split.total - split.kg[lift];
  return (p * others) / (1 - p);
}

/** The parts done for reps, in words: "bench ×5, deadlift ×3". Empty for all singles. */
export function repsNote(split: TotalSplit): string {
  return SPLIT_LIFTS.filter((l) => split.reps[l] > 1).map((l) => `${SPLIT_NAME[l].toLowerCase()} ×${split.reps[l]}`).join(", ");
}

export type GlRead = { value: number; estimate: boolean };

/** A total's GL points: a meet's official ones, else the IPF formula on the gym total (an estimate). */
export function glOf(row: Pick<StrengthRow, "lift" | "source" | "kg" | "bw_kg" | "sex"> & { gl_points?: number | null; meet?: StrengthRow["meet"] }): GlRead | null {
  if (row.lift !== "total") return null;
  const official = row.gl_points ?? row.meet?.gl_points ?? null;
  if (row.source === "meet") return official != null && official > 0 ? { value: official, estimate: false } : null;
  const v = glPoints(row.kg, row.bw_kg, row.sex === "male" ? "M" : row.sex === "female" ? "F" : null);
  return v != null ? { value: v, estimate: true } : null;
}

// ── The Hall's own numbers ─────────────────────────────────────────────────

/** A person's heaviest total (the board's absolute row). */
export function heaviestTotal(rows: StrengthRow[], key: string): StrengthRow | null {
  return rows.find((r) => r.key === key && r.lift === "total" && r.all_rank != null) ?? null;
}

/** A person's heaviest row for one lift. */
export function heaviestLift(rows: StrengthRow[], key: string, lift: SplitLift): StrengthRow | null {
  return rows.find((r) => r.key === key && r.lift === lift && r.all_rank != null) ?? null;
}

export type HallSplits = {
  /** each person's heaviest total with its split */
  people: { row: StrengthRow; split: TotalSplit }[];
  /** the Hall's average split per sex (mean of shares, totals of singles only), with how many lifters */
  average: Partial<Record<Sex, { share: Record<SplitLift, number>; count: number }>>;
};

/** Every heaviest total on a board that has its parts. */
export function hallSplits(rows: StrengthRow[]): HallSplits {
  const people: HallSplits["people"] = [];
  for (const r of rows) {
    if (r.lift !== "total" || r.all_rank == null) continue;
    const split = splitOf(r);
    if (split) people.push({ row: r, split });
  }
  // The Hall's average and its standouts read singles only: a total built on
  // a ×6 squat would make its bench look like the biggest share on the board.
  const average: HallSplits["average"] = {};
  for (const sex of ["male", "female"] as const) {
    const mine = people.filter((p) => p.row.sex === sex && p.split.singles);
    if (!mine.length) continue;
    const mean = (l: SplitLift) => mine.reduce((n, p) => n + p.split.share[l], 0) / mine.length;
    average[sex] = { share: { squat: mean("squat"), bench: mean("bench"), deadlift: mean("deadlift") }, count: mine.length };
  }
  return { people, average };
}

export type ShareRank = { lift: SplitLift; rank: number; of: number; top: boolean };

/**
 * Where a lifter's shares rank among their own sex on the board: the biggest
 * squat share of 14 men, the smallest bench share. Only ranks worth saying
 * (first or last of at least MIN_FOR_RANK) come back, among totals of singles.
 */
export const MIN_FOR_RANK = 5;
export function standoutShares(hall: HallSplits, key: string): ShareRank[] {
  const me = hall.people.find((p) => p.row.key === key);
  if (!me || !me.row.sex || !me.split.singles) return [];
  const peers = hall.people.filter((p) => p.row.sex === me.row.sex && p.split.singles);
  if (peers.length < MIN_FOR_RANK) return [];
  const out: ShareRank[] = [];
  for (const lift of SPLIT_LIFTS) {
    const sorted = [...peers].sort((a, b) => b.split.share[lift] - a.split.share[lift]);
    const rank = sorted.findIndex((p) => p.row.key === key) + 1;
    if (rank === 1) out.push({ lift, rank, of: peers.length, top: true });
    else if (rank === peers.length) out.push({ lift, rank, of: peers.length, top: false });
  }
  return out;
}

/** "Biggest bench share of the 14 men on the board" */
export function standoutLine(s: ShareRank, sex: Sex): string {
  return `${s.top ? "Biggest" : "Smallest"} ${SPLIT_NAME[s.lift].toLowerCase()} share of the ${s.of} ${sex === "male" ? "men" : "women"} on the board`;
}

// ── Head to head ───────────────────────────────────────────────────────────

export type Side = "a" | "b";

export type CompareLifter = {
  key: string;
  name: string;
  sex: Sex | null;
  total: StrengthRow;
  split: TotalSplit | null;
  lifts: Record<SplitLift, StrengthRow | null>;
  gl: GlRead | null;
  profile: LiftProfile | null;
  bw: number | null;
};

export function lifterFor(rows: StrengthRow[], key: string): CompareLifter | null {
  const total = heaviestTotal(rows, key);
  if (!total) return null;
  const split = splitOf(total);
  return {
    key,
    name: total.is_me ? "You" : total.display_name,
    sex: total.sex,
    total,
    split,
    lifts: { squat: heaviestLift(rows, key, "squat"), bench: heaviestLift(rows, key, "bench"), deadlift: heaviestLift(rows, key, "deadlift") },
    gl: glOf(total),
    profile: split ? liftProfile(split, total.sex) : null,
    bw: total.bw_kg,
  };
}

export type LiftDuel = {
  lift: SplitLift | "total";
  a: number | null;
  b: number | null;
  /** a − b, kg */
  diff: number | null;
  leader: Side | "tie" | null;
  aBw: number | null;
  bBw: number | null;
  /** who's stronger for their size on this lift (× bodyweight) */
  bwLeader: Side | "tie" | null;
};

export type Comparison = {
  a: CompareLifter;
  b: CompareLifter;
  duels: LiftDuel[];
  /** the gap between the two totals, lift by lift (from the totals' parts), biggest first */
  gap: { total: number; leader: Side | "tie"; parts: { lift: SplitLift; kg: number }[] } | null;
  /** the lines worth reading, most telling first */
  lines: string[];
  /** what sets each one apart */
  unique: Record<Side, string[]>;
  /** caveats: reps in a total, mixed sexes, missing bodyweights */
  notes: string[];
  /** one short headline */
  headline: string;
};

/** Within half a kilo is a tie (the board rounds to 0.1 kg; plates are 1.25 kg). */
const TIE_KG = 0.5;
const leaderOf = (diff: number | null, tie = TIE_KG): Side | "tie" | null => (diff == null ? null : Math.abs(diff) <= tie ? "tie" : diff > 0 ? "a" : "b");

function duel(lift: SplitLift | "total", ra: StrengthRow | null, rb: StrengthRow | null): LiftDuel {
  const a = ra?.kg ?? null;
  const b = rb?.kg ?? null;
  const diff = a != null && b != null ? a - b : null;
  const aBw = ra?.bw_multiple ?? null;
  const bBw = rb?.bw_multiple ?? null;
  return { lift, a, b, diff, leader: leaderOf(diff), aBw, bBw, bwLeader: aBw != null && bBw != null ? leaderOf(aBw - bBw, 0.005) : null };
}

const first = (name: string) => (name === "You" ? "You" : name.split(" ")[0]);

/**
 * Two lifters side by side, in plain words: who leads where and by how much,
 * how much of the gap between their totals each lift accounts for, who's
 * stronger for their size, and what sets each split apart.
 */
export function compareLifters(a: CompareLifter, b: CompareLifter, unit: WeightUnit, hall?: HallSplits): Comparison {
  const duels: LiftDuel[] = [...SPLIT_LIFTS.map((l) => duel(l, a.lifts[l], b.lifts[l])), duel("total", a.total, b.total)];
  const name = { a: first(a.name), b: first(b.name) } as const;
  const you = (s: Side) => name[s] === "You";
  const other = (s: Side): Side => (s === "a" ? "b" : "a");
  /** the subject at the start of a sentence: "You" / "Marc" */
  const subj = (s: Side) => name[s];
  /** the object: "you" / "Marc" */
  const obj = (s: Side) => (you(s) ? "you" : name[s]);
  /** possessive: "your" / "Marc's" */
  const poss = (s: Side) => (you(s) ? "your" : `${name[s]}'s`);
  /** their size: "your size" / "their size" */
  const size = (s: Side) => (you(s) ? "your size" : "their size");
  /** a verb for the subject: "out-total" (you) / "out-totals" */
  const v = (s: Side, plain: string, third: string) => (you(s) ? plain : third);
  const load = (kg: number) => formatLoad(Math.abs(kg), unit);
  const lines: string[] = [];
  const notes: string[] = [];

  // The gap between the totals, lift by lift (the parts add up to each total, so the gaps add up too).
  let gap: Comparison["gap"] = null;
  if (a.split && b.split) {
    // the totals as the board shows them (the parts are rounded on their own), split lift by lift
    const total = a.total.kg - b.total.kg;
    const parts = SPLIT_LIFTS.map((l) => ({ lift: l, kg: a.split!.kg[l] - b.split!.kg[l] })).sort((x, y) => Math.abs(y.kg) - Math.abs(x.kg));
    gap = { total, leader: leaderOf(total) ?? "tie", parts };
    if (gap.leader !== "tie") {
      const lead = gap.leader;
      const sign = lead === "a" ? 1 : -1;
      const forLeader = parts.filter((p) => p.kg * sign > TIE_KG);
      const against = parts.filter((p) => p.kg * sign < -TIE_KG);
      const top = forLeader[0];
      const opener = `${subj(lead)} ${v(lead, "out-total", "out-totals")} ${obj(other(lead))} by ${load(total)}`;
      if (top && forLeader.length === 1 && against.length === 0) {
        lines.push(`${opener}, all of it on the ${SPLIT_NAME[top.lift].toLowerCase()}.`);
      } else if (top) {
        const share = Math.abs(top.kg) / Math.abs(total);
        lines.push(share > 1.005
          ? `${opener}. The ${SPLIT_NAME[top.lift].toLowerCase()} alone is ${load(top.kg)}.`
          : `${opener}. The ${SPLIT_NAME[top.lift].toLowerCase()} is ${load(top.kg)} of it (${Math.round(share * 100)}%).`);
      }
      if (against.length) {
        const back = against.map((p) => `${SPLIT_NAME[p.lift].toLowerCase()} by ${load(p.kg)}`).join(" and the ");
        lines.push(`${subj(other(lead))} ${v(other(lead), "win", "wins")} back the ${back}.`);
      }
    } else {
      lines.push("Dead even on total: within half a kilo.");
    }
  }

  // For their size: GL when both have it (fair across bodyweights, and between men and women), else × bodyweight.
  const totalDuel = duels[3];
  if (a.gl && b.gl) {
    const lead = leaderOf(a.gl.value - b.gl.value, 0.05);
    const est = a.gl.estimate || b.gl.estimate ? " (a gym total's GL is an estimate)" : "";
    const hi = Math.max(a.gl.value, b.gl.value).toFixed(1);
    const lo = Math.min(a.gl.value, b.gl.value).toFixed(1);
    if (lead === "tie") lines.push(`Level pound for pound: ${hi} GL each${est}.`);
    else if (lead && gap && gap.leader !== "tie" && gap.leader !== lead) {
      lines.push(`${subj(gap.leader)} ${v(gap.leader, "lift", "lifts")} more, but ${obj(lead)} ${v(lead, "are", "is")} stronger for ${size(lead)}: ${hi} GL to ${lo}${est}.`);
    } else if (lead) {
      lines.push(`Pound for pound, ${obj(lead)} ${v(lead, "lead", "leads")}${gap && gap.leader === lead ? " too" : ""}: ${hi} GL to ${lo}${est}.`);
    }
  } else if (totalDuel.bwLeader && totalDuel.bwLeader !== "tie" && totalDuel.aBw != null && totalDuel.bBw != null) {
    const l = totalDuel.bwLeader;
    lines.push(`${subj(l)} ${v(l, "total", "totals")} more for ${size(l)}: ${Math.max(totalDuel.aBw, totalDuel.bBw).toFixed(2)}× bodyweight to ${Math.min(totalDuel.aBw, totalDuel.bBw).toFixed(2)}×.`);
  }
  if (a.bw != null && b.bw != null && Math.abs(a.bw - b.bw) >= 1) {
    const h: Side = a.bw > b.bw ? "a" : "b";
    lines.push(`${subj(h)} ${v(h, "weigh", "weighs")} ${load(a.bw - b.bw)} more (${formatLoad(h === "a" ? a.bw : b.bw, unit)} to ${formatLoad(h === "a" ? b.bw : a.bw, unit)}).`);
  }

  // What sets each split apart: against each other, then against a typical lifter, then on the board.
  const unique: Record<Side, string[]> = { a: [], b: [] };
  if (a.split && b.split) {
    const shareGap = SPLIT_LIFTS.map((l) => ({ lift: l, d: points(a.split!.share[l], b.split!.share[l]) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    const big = shareGap[0];
    if (Math.abs(big.d) >= 1) {
      const s: Side = big.d > 0 ? "a" : "b";
      const mine = s === "a" ? a.split : b.split;
      const theirs = s === "a" ? b.split : a.split;
      const theirsName = you(other(s)) ? "yours" : `${name[other(s)]}'s`;
      unique[s].push(`The ${SPLIT_NAME[big.lift].toLowerCase()} carries ${pct(mine.share[big.lift])} of ${poss(s)} total, ${pct(theirs.share[big.lift])} of ${theirsName}.`);
    } else {
      lines.push("Their splits are nearly identical: no lift differs by a full point.");
    }
  }
  for (const s of ["a", "b"] as const) {
    const me = s === "a" ? a : b;
    if (me.split && me.profile && me.sex) unique[s].push(profileShort(me.profile, me.sex));
    if (hall && me.sex) for (const st of standoutShares(hall, me.key)) unique[s].push(`${standoutLine(st, me.sex)}.`);
    // stronger for their size on a lift where the other moves more weight
    const sizeOnly = SPLIT_LIFTS.filter((l) => {
      const d = duels.find((x) => x.lift === l)!;
      return d.bwLeader === s && d.leader === other(s);
    });
    if (sizeOnly.length) {
      const which = sizeOnly.length === 3 ? "all three lifts" : `the ${sizeOnly.map((l) => SPLIT_NAME[l].toLowerCase()).join(" and ")}`;
      unique[s].push(`Less on the bar but more for ${size(s)} on ${which}.`);
    }
  }

  // Caveats, said once.
  for (const s of ["a", "b"] as const) {
    const me = s === "a" ? a : b;
    const r = me.split ? repsNote(me.split) : "";
    if (r) notes.push(`${you(s) ? "Your" : `${name[s]}'s`} total includes ${r}: done for reps, so ${r.includes(",") ? "those lifts read" : "that lift reads"} light next to singles.`);
  }
  if (a.sex && b.sex && a.sex !== b.sex) notes.push("A man and a woman: the kilos are what they are, and GL points are the fair comparison (the formula is set per sex).");
  if (!a.split || !b.split) notes.push("One of these totals came from an older board without its lifts. Pull down to refresh.");

  // The headline: who wins which lifts.
  const leadsOn = (s: Side) => SPLIT_LIFTS.filter((l) => duels.find((d) => d.lift === l)!.leader === s);
  const la = leadsOn("a");
  const lb = leadsOn("b");
  const list = (ls: SplitLift[]) => ls.map((l) => SPLIT_NAME[l].toLowerCase()).join(" + ");
  const headline =
    la.length === 3 ? `${subj("a")} ${v("a", "win", "wins")} all three lifts`
    : lb.length === 3 ? `${subj("b")} ${v("b", "win", "wins")} all three lifts`
    : la.length || lb.length ? [la.length ? `${subj("a")}: ${list(la)}` : null, lb.length ? `${subj("b")}: ${list(lb)}` : null].filter(Boolean).join(" · ")
    : "Too close to call";

  return { a, b, duels, gap, lines, unique, notes, headline };
}
