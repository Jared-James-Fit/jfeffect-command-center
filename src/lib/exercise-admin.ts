/**
 * Admin Exercise Library helpers — archive scope, sorting, and the
 * human-readable "Added" date derived from the canonical `created_at`.
 *
 * Kept pure so the archive/delete contract is unit-testable without
 * Supabase or React.
 */

export type ArchiveScope = "active" | "archived" | "all";
export type ExerciseSort = "newest" | "oldest" | "az";

export type AdminExerciseLike = {
  id: string;
  name?: string | null;
  archived?: boolean | null;
  created_at?: string | null;
};

export const ARCHIVE_SCOPES: { value: ArchiveScope; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

export const EXERCISE_SORTS: { value: ExerciseSort; label: string }[] = [
  { value: "az", label: "A–Z" },
  { value: "newest", label: "Newest added" },
  { value: "oldest", label: "Oldest added" },
];

export function filterByArchiveScope<T extends AdminExerciseLike>(
  rows: readonly T[],
  scope: ArchiveScope,
): T[] {
  if (scope === "all") return [...rows];
  const wantArchived = scope === "archived";
  return rows.filter((row) => (row.archived === true) === wantArchived);
}

function createdTime(row: AdminExerciseLike): number {
  const raw = row.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function sortExercises<T extends AdminExerciseLike>(
  rows: readonly T[],
  sort: ExerciseSort,
): T[] {
  const next = [...rows];
  if (sort === "az") {
    next.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
    return next;
  }
  next.sort((a, b) => {
    const diff = createdTime(b) - createdTime(a);
    if (diff !== 0) return sort === "newest" ? diff : -diff;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
  return next;
}

/** "Aug 21, 2026" — never a raw ISO string. */
export function formatAddedDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "Added Aug 21, 2026 at 8:42 PM" — tooltip / detail form. */
export function formatAddedDateTime(value: string | null | undefined): string {
  if (!value) return "Added date unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Added date unknown";
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Added ${date} at ${time}`;
}

export type ExerciseReferenceCounts = Record<string, number>;

export const REFERENCE_LABELS: Record<string, string> = {
  member_set_logs: "logged sets",
  pl_exercise_rows: "program prescriptions",
  pl_client_maxes: "recorded maxes",
  pl_exercise_notes: "coach notes",
  member_exercise_notes: "member notes",
  member_exercise_swaps: "exercise swaps",
  warmup_assignments: "warm-up assignments",
};

export function totalReferences(counts: ExerciseReferenceCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

export function isSafeToHardDelete(counts: ExerciseReferenceCounts): boolean {
  return totalReferences(counts) === 0;
}

export function describeReferences(counts: ExerciseReferenceCounts): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => (Number(n) || 0) > 0)
    .map(([table, n]) => `${n} ${REFERENCE_LABELS[table] ?? table}`);
  return parts.join(", ");
}

export const REFERENCED_DELETE_MESSAGE =
  "This exercise is already used in training history. Archive it instead.";
