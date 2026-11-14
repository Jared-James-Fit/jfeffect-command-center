/**
 * What a runner's logged runs say, for Training Analytics' Running card (the
 * athlete's and the coach's alike). Pure (tested); the card only loads rows.
 *
 * - A session is one workout's running sets together (warm-up, main set and
 *   cool-down), filed under the kind of its main set (Easy, Long run,
 *   Threshold…), so a 5-minute warm-up never makes a threshold day read as
 *   an easy run.
 * - Pace is only ever compared within one kind of run (easy with easy,
 *   threshold with threshold) and from the main set's own laps, never across
 *   kinds: a faster average pace from more quality sessions isn't fitness.
 * - Readiness is the programs' own rule (running.ts PROGRESSION_GUIDE), read
 *   from the last 14 days: planned runs done, and whether easy runs still feel
 *   easy. It never says "progress" because time passed.
 */
import { paceSeconds, type DistanceUnit } from "./run-log";

export type RunLogSet = {
  /** the day it was run, yyyy-mm-dd, in the athlete's own time */
  date: string;
  /** one workout (its scheduled instance, else its program day) */
  sessionKey: string;
  role: string | null;
  seconds: number | null;
  meters: number | null;
  rpe: number | null;
  /** the row's prescribed RPE ("3-4") */
  targetRpe: string | null;
};

export type PlannedRun = { date: string; dayId: string; optional: boolean; done: boolean };

export type RunKind = "Race" | "Race effort" | "Marathon pace" | "Threshold" | "Steady" | "Long run" | "Easy";
const KIND_OF_ROLE: Record<string, RunKind> = {
  race: "Race", "5k": "Race",
  "race effort": "Race effort",
  "marathon pace": "Marathon pace",
  threshold: "Threshold", tempo: "Threshold",
  steady: "Steady", fartlek: "Steady",
  "long run": "Long run", "medium-long": "Long run",
  easy: "Easy", recovery: "Easy", "run/walk": "Easy",
};
const KIND_ORDER: RunKind[] = ["Race", "Race effort", "Marathon pace", "Threshold", "Steady", "Long run", "Easy"];
/** the kind a row's role counts as; warm-ups, cool-downs and strides count as volume, never as a kind */
export function kindOfRole(role: string | null | undefined): RunKind | null {
  return KIND_OF_ROLE[String(role ?? "").trim().toLowerCase()] ?? null;
}
/** the top of an RPE target: "3-4" → 4 */
export function targetTop(rpe: string | null | undefined): number | null {
  const nums = String(rpe ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number).filter((n) => n > 0 && n <= 10) ?? [];
  return nums.length ? Math.max(...nums) : null;
}

export type RunSession = {
  key: string;
  date: string;
  kind: RunKind;
  seconds: number;
  meters: number;
  /** the main set's own pace (seconds per km), when it has time and distance */
  paceSecPerKm: number | null;
  /** the hardest RPE logged on the main set */
  rpe: number | null;
  /** the main set's prescribed RPE top */
  targetTop: number | null;
};

export function runSessions(sets: RunLogSet[]): RunSession[] {
  const byKey = new Map<string, RunLogSet[]>();
  for (const s of sets) byKey.set(s.sessionKey, [...(byKey.get(s.sessionKey) ?? []), s]);
  const out: RunSession[] = [];
  for (const [key, xs] of byKey) {
    const kinds = xs.map((x) => kindOfRole(x.role)).filter((k): k is RunKind => k != null);
    const kind = KIND_ORDER.find((k) => kinds.includes(k)) ?? "Easy";
    const main = xs.filter((x) => kindOfRole(x.role) === kind);
    const timed = (main.length ? main : xs).filter((x) => Number(x.seconds) > 0 && Number(x.meters) > 0);
    const paceSecs = timed.reduce((t, x) => t + Number(x.seconds), 0);
    const paceMeters = timed.reduce((t, x) => t + Number(x.meters), 0);
    const rpes = (main.length ? main : xs).map((x) => x.rpe).filter((n): n is number => n != null && n > 0);
    const tops = (main.length ? main : xs).map((x) => targetTop(x.targetRpe)).filter((n): n is number => n != null);
    out.push({
      key,
      date: xs.map((x) => x.date).sort()[0],
      kind,
      seconds: xs.reduce((t, x) => t + (Number(x.seconds) > 0 ? Number(x.seconds) : 0), 0),
      meters: xs.reduce((t, x) => t + (Number(x.meters) > 0 ? Number(x.meters) : 0), 0),
      paceSecPerKm: paceSeconds(paceSecs, paceMeters, "km"),
      rpe: rpes.length ? Math.max(...rpes) : null,
      targetTop: tops.length ? Math.max(...tops) : null,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

const DAY = 86_400_000;
const toDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
/** the Monday that starts ymd's week */
export function weekStart(ymd: string): string {
  const d = toDate(ymd);
  const dow = (d.getUTCDay() + 6) % 7;
  return ymdOf(new Date(d.getTime() - dow * DAY));
}

export type RunWeek = { weekStart: string; runs: number; meters: number; seconds: number; longestMeters: number };

/** The last `count` weeks up to `endYmd`, oldest first, empty weeks included. */
export function runWeeks(sessions: RunSession[], endYmd: string, count = 8): RunWeek[] {
  const last = weekStart(endYmd);
  const weeks: RunWeek[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const ws = ymdOf(new Date(toDate(last).getTime() - i * 7 * DAY));
    const xs = sessions.filter((s) => weekStart(s.date) === ws);
    weeks.push({
      weekStart: ws,
      runs: xs.length,
      meters: xs.reduce((t, s) => t + s.meters, 0),
      seconds: xs.reduce((t, s) => t + s.seconds, 0),
      longestMeters: Math.max(0, ...xs.map((s) => s.meters)),
    });
  }
  return weeks;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type KindPace = { kind: RunKind; sessions: number; recent: number | null; before: number | null };

/** Each kind of run's typical pace (seconds per km): its last 4 sessions against the 4 before (2+ each to compare). */
export function paceByKind(sessions: RunSession[]): KindPace[] {
  return KIND_ORDER.filter((k) => k !== "Race")
    .map((kind) => {
      const paced = sessions.filter((s) => s.kind === kind && s.paceSecPerKm != null);
      const recent = paced.slice(-4).map((s) => s.paceSecPerKm as number);
      const before = paced.slice(-8, -4).map((s) => s.paceSecPerKm as number);
      return {
        kind,
        sessions: sessions.filter((s) => s.kind === kind).length,
        recent: median(recent),
        before: recent.length >= 2 && before.length >= 2 ? median(before) : null,
      };
    })
    .filter((k) => k.recent != null);
}

/** pace per km → per the unit asked for */
export const paceIn = (secPerKm: number, unit: DistanceUnit) => (unit === "km" ? secPerKm : secPerKm * 1.609344);

export type Readiness = {
  status: "progress" | "hold" | "back_off" | "unknown";
  label: string;
  reasons: string[];
};

/** How many easy runs in a row (most recent 4) went clearly over their prescribed effort. */
function easyDrift(sessions: RunSession[]): RunSession[] {
  return sessions
    .filter((s) => (s.kind === "Easy" || s.kind === "Long run") && s.rpe != null && s.targetTop != null)
    .slice(-4)
    .filter((s) => (s.rpe as number) > (s.targetTop as number) + 1);
}

/**
 * Ready to move on, repeat the week, or back off, from the last 14 days: planned
 * runs done (optional ones only count once they're done), and easy runs that
 * still feel easy. With too little to go on it says so.
 */
export function runReadiness(sessions: RunSession[], planned: PlannedRun[], todayYmd: string): Readiness {
  const from = ymdOf(new Date(toDate(todayYmd).getTime() - 13 * DAY));
  const inWindow = (d: string) => d >= from && d <= todayYmd;
  const due = planned.filter((p) => inWindow(p.date) && (!p.optional || p.done));
  const done = due.filter((p) => p.done).length;
  const recent = sessions.filter((s) => inWindow(s.date));
  const drift = easyDrift(sessions.filter((s) => s.date <= todayYmd));
  const reasons: string[] = [];
  if (due.length >= 3) reasons.push(`${done} of ${due.length} planned runs done in the last 2 weeks.`);
  else if (recent.length) reasons.push(`${recent.length} run${recent.length === 1 ? "" : "s"} in the last 2 weeks.`);
  if (drift.length >= 2) {
    reasons.push(`Easy runs are feeling hard (RPE ${drift.map((s) => s.rpe).join(", ")} against a target of ${drift[0].targetTop} or less): check sleep, fueling and that the pace really is easy.`);
  }
  if (due.length < 3 && recent.length < 3) {
    return { status: "unknown", label: "Not enough runs yet", reasons: reasons.length ? reasons : ["Log a few runs and this shows whether to move on."] };
  }
  const completion = due.length >= 3 ? done / due.length : 1;
  if (due.length >= 3 && completion < 0.5) {
    return { status: "back_off", label: "Back off", reasons: [...reasons, "Go back to the last week they completed and rebuild from there; never stack missed runs."] };
  }
  if (completion < 0.8 || drift.length >= 2) {
    return { status: "hold", label: "Repeat this week", reasons: [...reasons, "Repeat the week before moving on."] };
  }
  return { status: "progress", label: "Ready to progress", reasons: [...reasons, "Easy runs feel easy: on to the next week."] };
}
