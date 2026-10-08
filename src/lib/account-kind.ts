/**
 * True when one of a login's clients rows is a coaching client. Member
 * athletes (athlete_kind 'member', created when a member builds a workout)
 * are members, not clients. A row without the column (a database where the
 * athlete_kind migration isn't applied yet) counts as coaching.
 */
export function isCoachingClientRow(rows: Array<{ athlete_kind?: string | null }> | null | undefined): boolean {
  return (rows ?? []).some((r) => (r?.athlete_kind ?? "coaching") === "coaching");
}
