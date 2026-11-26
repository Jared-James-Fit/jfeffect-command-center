/**
 * The training context a strength read needs (pure, tested): which phase each
 * day sits in, from the athlete's own blocks (their stated type, else what
 * the block's words say, block-types.ts), weight cuts from their bodyweight
 * trend, and pain that touches a lift.
 */
import { dayMs, DAY_MS } from "./rules";
import type { PhaseKind, PhaseSpan } from "./estimate";

/** A block type (block-types.ts keys) as the phase the strength read cares about. */
export function phaseOfBlockType(key: string | null | undefined): PhaseKind {
  switch (String(key ?? "")) {
    case "accumulation":
    case "hypertrophy":
    case "general_prep":
      return "accumulation";
    case "intensification":
      return "intensification";
    case "peaking":
      return "peaking";
    case "taper":
      return "taper";
    case "deload":
      return "deload";
    case "rehab":
      return "injury";
    default:
      return "normal";
  }
}

const WORDS: Array<[RegExp, PhaseKind]> = [
  [/\b(deload|unload(ing)?)\b/i, "deload"],
  [/\btaper(ing)?\b/i, "taper"],
  [/\b(peak|peaking|meet prep|comp(etition)? prep)\b/i, "peaking"],
  [/\b(intensif\w*|realization|realisation)\b/i, "intensification"],
  [/\b(accumulat\w*|volume|hypertroph\w*|off[- ]?season|gpp|general prep\w*|base)\b/i, "accumulation"],
  [/\b(rehab\w*|return to)\b/i, "injury"],
];

/** Phases from blocks: their stated type first, else the words in their name or phase. */
export function phasesFromBlocks(
  blocks: Array<{
    start_date?: string | null;
    end_date?: string | null;
    block_type?: string | null;
    name?: string | null;
    phase?: string | null;
  }>,
): PhaseSpan[] {
  const out: PhaseSpan[] = [];
  for (const b of blocks ?? []) {
    if (!b.start_date) continue;
    const end = b.end_date || new Date(dayMs(b.start_date) + 7 * 16 * DAY_MS).toISOString().slice(0, 10);
    let kind: PhaseKind = phaseOfBlockType(b.block_type);
    if (kind === "normal") {
      const text = `${b.phase ?? ""} ${b.name ?? ""}`;
      kind = WORDS.find(([re]) => re.test(text))?.[1] ?? "normal";
    }
    if (kind !== "normal") out.push({ start: b.start_date.slice(0, 10), end: end.slice(0, 10), kind, label: b.name ?? null });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Weight cuts: stretches where the 3-week least-squares trend of their
 * weigh-ins loses more than 0.5% a week (4+ weigh-ins in the window).
 */
export function cutPhases(weighIns: Array<{ day: string; kg: number }>): PhaseSpan[] {
  const pts = (weighIns ?? []).filter((w) => w.kg > 0).sort((a, b) => a.day.localeCompare(b.day));
  const out: PhaseSpan[] = [];
  for (const p of pts) {
    const win = pts.filter((q) => q.day <= p.day && (dayMs(p.day) - dayMs(q.day)) / DAY_MS <= 21);
    if (win.length < 4) continue;
    const xs = win.map((q) => (dayMs(q.day) - dayMs(win[0].day)) / DAY_MS);
    const ys = win.map((q) => q.kg);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    if (!(sxx > 0)) continue;
    const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
    const perWeek = (slope * 7) / my;
    if (perWeek > -0.005) continue;
    const start = win[0].day;
    const last = out[out.length - 1];
    if (last && dayMs(start) <= dayMs(last.end) + 7 * DAY_MS) last.end = p.day;
    else out.push({ start, end: p.day, kind: "cut", label: null });
  }
  return out;
}

/** The competition lifts a painful place loads (a coarse map: what to be careful reading, not a diagnosis). */
export function liftsForRegion(region: string | null | undefined): Array<"squat" | "bench" | "deadlift"> {
  const r = String(region ?? "").toLowerCase();
  if (/shoulder|pec|chest|elbow|wrist|tricep|bicep/.test(r)) return ["bench"];
  if (/knee|quad|hip|groin|adductor|glute/.test(r)) return ["squat", "deadlift"];
  if (/back|spine|lumbar|hamstring|si\b|sacro/.test(r)) return ["squat", "deadlift"];
  return [];
}

/** Two weeks after each pain report on a lift is read like a fatigue phase for it. */
export function painPhases(
  reports: Array<{ day: string; region?: string | null; score?: number | null }>,
  lift: "squat" | "bench" | "deadlift",
): PhaseSpan[] {
  return (reports ?? [])
    .filter((p) => (p.score ?? 5) >= 4 && liftsForRegion(p.region).includes(lift))
    .map((p) => ({
      start: p.day,
      end: new Date(dayMs(p.day) + 14 * DAY_MS).toISOString().slice(0, 10),
      kind: "injury" as const,
      label: p.region ?? null,
    }));
}
