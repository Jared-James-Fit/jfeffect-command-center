/**
 * Supersets in the program editor (Nov 23 2026). A pairing has no column of
 * its own: it lives where the athlete already reads it, at the start of each
 * exercise's note, in the words Generate Next Program writes
 * (`supersetNote`, program-view.ts): "Superset with X: one set of each, then
 * rest." Pure, so the editor, the tests and anything that reads a note agree.
 */

const LEAD = /^\s*Superset with (.+?): one set of each, then rest\.(?:\s*·\s*|\s+)?/i;

/** Who an exercise is paired with ("Lat Pulldown"), else null. */
export function supersetPartner(notes: string | null | undefined): string | null {
  const m = LEAD.exec(String(notes ?? ""));
  return m ? m[1].trim() : null;
}

/** The note without its superset line (whatever else the coach wrote stays). */
export function withoutSuperset(notes: string | null | undefined): string {
  return String(notes ?? "").replace(LEAD, "").trim();
}

/** The note with this exercise paired with `partner` (an old pairing replaced). */
export function withSuperset(notes: string | null | undefined, partner: string): string {
  const rest = withoutSuperset(notes);
  const lead = `Superset with ${partner.trim()}: one set of each, then rest.`;
  return rest ? `${lead} · ${rest}` : lead;
}
