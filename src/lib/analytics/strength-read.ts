/**
 * How the app reads strength from logged sets, in one place for the lift
 * charts, the History & progress card, the Performance insights and (by the
 * same rule) Program Intelligence's athlete development.
 *
 * An estimated max (e1RM) is only comparable session to session when it comes
 * from a set that could show a max: a hard set (RPE 7+ / 3 or fewer reps in
 * reserve) of 10 reps or fewer, read with its effort (Epley on the reps done
 * plus the reps left, `estimate1RMWithRpe`, the formula Program Intelligence
 * uses). A light day, a technique single at RPE 5 or an unrated back-off says
 * little about a max, and reading every set as if it were all-out drew a chart
 * that jumped a median 10% between sessions on real logs (Nov 2026: 375
 * session-to-session changes on the competition lifts, 1 in 10 over 39%);
 * comparable sets only, a median 6%.
 *
 * The trend says up / down / steady from the best sessions at the start and
 * the end (strength shows in the best sessions, not the average one, the same
 * as athlete-development's `ends`), and "too early to call" with too few
 * comparable sessions or too short a span. It never reads one session as a
 * change, and a change under 2% is steady: normal day-to-day variation.
 */
import { estimate1RMWithRpe } from "@/lib/analytics/e1rm";

export const COMPARABLE_MIN_RPE = 7;
export const COMPARABLE_MAX_REPS = 10;
/** Comparable sessions needed before a trend is called, and the span they must cover. */
export const TREND_MIN_SESSIONS = 4;
export const TREND_MIN_DAYS = 21;
/** A change smaller than this is steady (normal variation between good sessions). */
export const STEADY_PCT = 2;

type SetLike = { load: number; reps: number; rpe?: number | string | null; rir?: number | string | null };

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** The set's effort on the RPE scale (RIR 2 = RPE 8), or null when none was logged. */
export function effortOf(s: Pick<SetLike, "rpe" | "rir">): number | null {
  const rpe = num(s.rpe);
  if (rpe != null && rpe > 0) return Math.min(10, rpe);
  const rir = num(s.rir);
  if (rir != null && rir >= 0) return Math.max(0, 10 - rir);
  return null;
}

/** The set's estimated max when it's a set that can show one, else null. */
export function comparableE1rm(s: SetLike): number | null {
  if (!(s.load > 0) || !(s.reps >= 1) || s.reps > COMPARABLE_MAX_REPS) return null;
  const effort = effortOf(s);
  if (effort == null || effort < COMPARABLE_MIN_RPE) return null;
  const e = estimate1RMWithRpe(s.load, s.reps, effort);
  return e > 0 ? e : null;
}

export type StrengthTrend =
  | {
      kind: "up" | "down" | "steady";
      pct: number;
      first: number;
      last: number;
      sessions: number;
      days: number;
      /** the day of the best of the first few sessions: what "up 9%" is measured from */
      firstDate: string;
      /** the day of the best of the last few */
      lastDate: string;
    }
  | { kind: "unclear"; sessions: number; days: number; reason: "few" | "short" };

/** Up / down / steady from the best of the first and the last few points; "unclear" with too little to go on. */
export function strengthTrend(points: ReadonlyArray<{ date: string; value: number }>): StrengthTrend {
  const pts = points.filter((p) => p.value > 0 && p.date).slice().sort((a, b) => a.date.localeCompare(b.date));
  const days = pts.length >= 2 ? Math.round((Date.parse(pts[pts.length - 1].date) - Date.parse(pts[0].date)) / 86_400_000) : 0;
  if (pts.length < TREND_MIN_SESSIONS) return { kind: "unclear", sessions: pts.length, days, reason: "few" };
  if (days < TREND_MIN_DAYS) return { kind: "unclear", sessions: pts.length, days, reason: "short" };
  const k = Math.min(3, Math.max(1, Math.floor(pts.length / 3)));
  const best = (xs: typeof pts) => xs.reduce((a, p) => (p.value > a.value ? p : a), xs[0]);
  const firstP = best(pts.slice(0, k));
  const lastP = best(pts.slice(-k));
  const first = firstP.value;
  const last = lastP.value;
  const pct = Math.round(((last - first) / first) * 1000) / 10;
  const kind = Math.abs(pct) < STEADY_PCT ? "steady" : pct > 0 ? "up" : "down";
  return { kind, pct, first, last, sessions: pts.length, days, firstDate: firstP.date.slice(0, 10), lastDate: lastP.date.slice(0, 10) };
}

/** "Up 4.2%" / "Down 3%" / "Steady" / "Too early", for a tile or a line. */
export function trendWords(t: StrengthTrend): string {
  if (t.kind === "unclear") return "Too early";
  if (t.kind === "steady") return "Steady";
  return `${t.kind === "up" ? "Up" : "Down"} ${Math.abs(t.pct)}%`;
}
