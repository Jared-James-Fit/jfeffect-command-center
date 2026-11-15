/**
 * How a note reads in a list, a search and as a task: shared by Quick notes
 * (private) and Team notes (shared with a group).
 */
type Text = { title: string; body: string };

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export function noteHeading(n: Text) {
  return n.title.trim() || lines(n.body)[0] || "Untitled note";
}
export function notePreview(n: Text) {
  const ls = lines(n.body);
  return (n.title.trim() ? ls[0] : ls[1]) ?? "";
}
/** Something written in it (a brand-new, untouched note isn't worth keeping). */
export const hasText = (n: Text) => !!(n.title.trim() || n.body.trim());

/**
 * Task fields for a note: its title (or first line) becomes the task title
 * and the rest of the text rides along as the task notes. Null when empty.
 */
export function noteToTask(n: Text): { title: string; notes: string | null } | null {
  const bodyLines = n.body.split("\n");
  const firstIdx = bodyLines.findIndex((l) => l.trim());
  const title = (n.title.trim() || (firstIdx >= 0 ? bodyLines[firstIdx].trim() : "")).slice(0, 200);
  if (!title) return null;
  const rest = n.title.trim() ? n.body : bodyLines.slice(firstIdx + 1).join("\n");
  return { title, notes: rest.trim() ? rest.trim() : null };
}

/** Most recently edited first, like Apple Notes. */
export function sortByRecent<T extends { updatedAt: number }>(notes: T[]): T[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}
export function noteMatches(n: Text, q: string) {
  const s = q.trim().toLowerCase();
  return !s || `${n.title}\n${n.body}`.toLowerCase().includes(s);
}
