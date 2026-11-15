/**
 * What an exercise card's one-line coach note shows before it's opened, when
 * the whole note doesn't fit on the line: its first sentence (or first line),
 * without the stop at its end. Cutting the whole note at the edge of the line
 * put the browser's "…" straight after a period ("RPE (velocity optional).…"),
 * which read like a typo; the first sentence with "More" beside it reads as a
 * cue with more to come (the same reason a caption's stop gives way to its
 * "…", caption-preview.ts).
 *
 * A sentence ends at ., ! or ? followed by a space and a capital or a number
 * ("min. Load is…", "RPE 6. 2 sets"), so "e.g. pause" or "2.5 kg" never split
 * one; a line break always does. Returns null when there's nothing after the
 * first sentence (a single long sentence is just cut by the line).
 */
export function noteLead(notes: string): string | null {
  const text = notes.trim();
  const m = /^([\s\S]*?(?:[.!?](?=\s+["'(]?[A-Z0-9])|(?=\n)))/.exec(text);
  if (!m) return null;
  const lead = m[1].replace(/[\s.:;,]+$/, "").trim();
  const rest = text.slice(m[1].length).trim();
  if (!lead || !rest) return null;
  return lead;
}
