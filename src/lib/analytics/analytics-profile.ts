/**
 * Which analytics lead for an athlete: a powerlifter's Overview opens on the
 * competition lifts and where they stand; someone training for muscle opens
 * on where their weekly sets go by muscle; anyone else on consistency. Every
 * section stays one tab away for everyone (and the coach always sees all of
 * it): this only decides what comes first.
 *
 * What they actually train beats what a form said: someone logging the
 * competition lifts week in, week out reads as a powerlifter whatever their
 * Goals & Setup says.
 */
export type AnalyticsProfile = "powerlifting" | "physique" | "general";

export const PL_SESSIONS_MIN = 6;

export function analyticsProfile(input: {
  mainGoal?: string | null;
  styles?: string[] | null;
  /** distinct days with a competition-lift set in the last 12 weeks */
  compSessions12w: number;
  /** an upcoming meet on a meet prep */
  hasMeet?: boolean;
}): AnalyticsProfile {
  const goal = (input.mainGoal ?? "").toLowerCase();
  const styles = (input.styles ?? []).map((s) => s.toLowerCase());
  if (input.hasMeet || input.compSessions12w >= PL_SESSIONS_MIN) return "powerlifting";
  if (
    goal.includes("powerlifting") ||
    goal.includes("competition") ||
    styles.includes("powerlifting")
  ) {
    return "powerlifting";
  }
  if (
    goal.includes("muscle") ||
    goal.includes("recomp") ||
    goal.includes("body fat") ||
    styles.some((s) => s.includes("bodybuilding") || s.includes("glute"))
  ) {
    return "physique";
  }
  return "general";
}

/** Distinct local days with a competition-lift set since `sinceMs`. */
export function compSessionsSince(results: any[], sinceMs: number): number {
  const days = new Set<string>();
  for (const r of results ?? []) {
    if (r?.is_competition_lift !== true || !r.date) continue;
    const t = new Date(r.date).getTime();
    if (t < sinceMs) continue;
    days.add(String(r.date).slice(0, 10));
  }
  return days.size;
}
