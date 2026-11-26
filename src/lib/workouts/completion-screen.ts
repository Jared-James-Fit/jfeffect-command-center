/**
 * The workout completion screen's words and numbers (Nov 25 2026, pure, tested
 * in workout-completion-screen.test.ts): achievement first, then performance,
 * then sharing, then Done. Every line is worked out from what was logged,
 * never a guess and never praise the numbers don't back.
 */
import type { WorkoutRecords, RepRecord } from "@/lib/training-records";

export type PlanLineKind = "harder" | "short" | "easier" | "extra" | string;

/**
 * The one line under the score. In order: a headline PR (the AGENTS.md
 * headline rule, never an accessory's 15-rep best) → "New personal best.";
 * every prescribed set done with nothing short or run hot →
 * "Every prescribed set completed."; a high score with nothing short or hot →
 * "Strong session."; anything else → "Session complete." (a plan that ran hot
 * or came up short is never cheered).
 */
export function completionMessage(o: {
  headlinePr: boolean;
  completedSets: number;
  prescribedSets: number;
  score: number;
  planLines?: { kind: PlanLineKind }[] | null;
  pain?: boolean | null;
}): string {
  if (o.headlinePr) return "New personal best.";
  const strayed = (o.planLines ?? []).some((l) => l.kind === "harder" || l.kind === "short");
  if (!strayed && o.prescribedSets > 0 && o.completedSets >= o.prescribedSets) return "Every prescribed set completed.";
  if (!strayed && !o.pain && o.score >= 85) return "Strong session.";
  return "Session complete.";
}

export type CompletionStat = { key: "duration" | "sets" | "filmed" | "volume" | "prs" | "points"; label: string; value: string };

/**
 * The horizontal stats, only the ones this workout has: a cardio-only day has
 * no volume, a workout with no film no Filmed, no PRs no PRs. At most five.
 */
export function completionStats(o: {
  durationMin?: number | null;
  completedSets: number;
  prescribedSets: number;
  filmed?: number | null;
  volume?: string | null;
  prs?: number | null;
  leaguePoints?: number | null;
}): CompletionStat[] {
  const out: CompletionStat[] = [];
  if (o.durationMin != null && o.durationMin > 0) out.push({ key: "duration", label: "Time", value: formatMinutes(o.durationMin) });
  if (o.completedSets > 0 || o.prescribedSets > 0)
    out.push({ key: "sets", label: "Sets", value: o.prescribedSets > 0 ? `${o.completedSets}/${o.prescribedSets}` : String(o.completedSets) });
  if (o.volume) out.push({ key: "volume", label: "Volume", value: o.volume });
  if (o.filmed && o.filmed > 0) out.push({ key: "filmed", label: "Filmed", value: String(o.filmed) });
  if (o.prs && o.prs > 0) out.push({ key: "prs", label: o.prs === 1 ? "Record" : "Records", value: String(o.prs) });
  if (out.length < 5 && o.leaguePoints && o.leaguePoints > 0) out.push({ key: "points", label: "League", value: `+${o.leaguePoints}` });
  return out.slice(0, 5);
}

/** "48m", "1h 12m". */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export type RecordsLine = {
  count: number;
  /** Lifts with a record, the headline one first, each once. */
  names: string[];
  /** Every record is an all-time one: "personal record(s)"; else "record(s)" (a block or program best isn't a personal best). */
  allTime: boolean;
};

/** The records this workout set, counted the way New records lists them (a set that's both a rep and a weight record is one). */
export function recordsLine(records: WorkoutRecords | null | undefined, leadName?: string | null): RecordsLine | null {
  if (!records) return null;
  const bySet = new Map<string, RepRecord>();
  for (const r of records.records ?? []) bySet.set(r.set_id, r);
  for (const r of records.load_records ?? []) if (!bySet.has(r.set_id)) bySet.set(r.set_id, r);
  const t = records.tonnage;
  const tonnage = !!t && (t.atpr || t.program_pr || t.block_pr);
  const count = bySet.size + (tonnage ? 1 : 0);
  if (!count) return null;
  const names: string[] = [];
  const add = (n: string | null | undefined) => {
    const v = (n ?? "").trim();
    if (v && !names.includes(v)) names.push(v);
  };
  add(leadName);
  for (const r of bySet.values()) add(r.exercise_name);
  if (tonnage) add("Workout tonnage");
  const allTime = [...bySet.values()].every((r) => r.atpr) && (!tonnage || !!t?.atpr);
  return { count, names, allTime };
}

/** "2 new personal records · Competition Squat · Competition Bench" (at most `maxNames` names, then "+N"). */
export function recordsText(line: RecordsLine, maxNames = 2): string {
  const noun = line.allTime ? "personal record" : "record";
  const head = `${line.count} new ${noun}${line.count === 1 ? "" : "s"}`;
  const shown = line.names.slice(0, maxNames);
  const more = line.names.length - shown.length;
  return [head, ...shown, ...(more > 0 ? [`+${more}`] : [])].join(" · ");
}

/** Where the workout already is, said once: Crew (its post or its film, the same one slot), a story, an automatic story, hidden. */
export type RecapStatus = "crew" | "crew+story" | "story" | "auto" | "hidden" | null;

export function recapStatus(o: { inFeed: boolean; filmPosted: boolean; storyShared: boolean; autoUp: boolean; hidden: boolean }): RecapStatus {
  const crew = o.inFeed || o.filmPosted;
  if (crew) return o.storyShared ? "crew+story" : "crew";
  if (o.storyShared) return "story";
  if (o.autoUp) return "auto";
  if (o.hidden) return "hidden";
  return null;
}

/** The score ring's arc: the stroke-dasharray for a circle of radius `r` at `score`/100. */
export function ringDash(score: number, r: number): { length: number; dash: string } {
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, score)) / 100;
  return { length: c, dash: `${(c * v).toFixed(2)} ${c.toFixed(2)}` };
}
