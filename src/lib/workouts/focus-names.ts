/**
 * What Focus calls each card (its bars' list and the "Next:" button). Most
 * cards are just the exercise. When the same exercise is on more than one card
 * of the day (a top set, then its back-offs), each says which one it is, from
 * the program itself, never a made-up label:
 *
 *   - a card the coach calls a back-off (its purpose label, or notes that start
 *     "Backoff") is "Backoff", and the card of that exercise before it is
 *     "Top set" (the same rule as the server's pl_day_set_names);
 *   - otherwise its purpose label as written ("Secondary squat");
 *   - with no label, its prescription ("2 × 4"), which is what tells two
 *     identical names apart on the platform anyway.
 *
 * "Next: Competition Squat" while the athlete was already on Competition Squat
 * read like a bug; "Next: Competition Squat · Backoff" says where they're going.
 */
import { purposeLabelText } from "@/lib/exercise-metadata";

export type FocusNameRow = {
  name: string;
  purposeLabel?: string | null;
  notes?: string | null;
  sets?: number | string | null;
  reps?: string | null;
};

const BACKOFF = /\bback[\s-]?offs?\b/i;
const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function isBackoffRow(r: Pick<FocusNameRow, "purposeLabel" | "notes">): boolean {
  return BACKOFF.test(r.purposeLabel ?? "") || /^\s*back[\s-]?offs?\b/i.test(r.notes ?? "");
}

function prescription(r: FocusNameRow): string | null {
  const sets = Number(r.sets);
  const reps = (r.reps ?? "").trim();
  if (!(sets > 0) || !reps) return null;
  return `${sets} × ${reps}`;
}

export function focusNames(rows: readonly FocusNameRow[]): string[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(key(r.name), (count.get(key(r.name)) ?? 0) + 1);
  return rows.map((r, i) => {
    if ((count.get(key(r.name)) ?? 0) < 2) return r.name;
    let role: string | null = null;
    if (isBackoffRow(r)) role = "Backoff";
    else {
      const next = rows.slice(i + 1).find((x) => key(x.name) === key(r.name));
      if (next && isBackoffRow(next)) role = "Top set";
      else if (r.purposeLabel?.trim()) role = purposeLabelText(r.purposeLabel);
      else role = prescription(r);
    }
    return role ? `${r.name} · ${role}` : r.name;
  });
}
