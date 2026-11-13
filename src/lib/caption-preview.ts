/**
 * The words shown before "… more" when a feed caption is cut at a clean stop
 * (NoteCaption). A sentence's period, or the colon / comma / semicolon before
 * a list or a new line, gives way to the ellipsis ("sneaky… more", never
 * "sneaky.… more" or "now:… more"), and a ? or ! keeps its mark with a space
 * before it.
 */
export function cutPreview(text: string, cut: number): { shown: string; gap: string } {
  const at = text.slice(0, cut).trimEnd();
  const shown = at.replace(/[.:;,…]+$/, "");
  return { shown: shown || at, gap: /[!?]$/.test(shown) ? " " : "" };
}

/** The preview exactly as it reads, "… more" included: what NoteCaption measures. */
export function previewLine(text: string, cut: number): string {
  const { shown, gap } = cutPreview(text, cut);
  return `${shown}${gap}… more`;
}

/**
 * A caption as one run of words for a short preview (Reels'): line breaks and
 * runs of spaces read as one space, so two lines show as much as they can.
 */
export function flatCaption(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Where a preview may stop: the end of every word that more words follow
 * (ascending; the full length is never one). Reels' preview cuts at a word,
 * mid-sentence or not, and "… more" opens the rest.
 */
export function wordStops(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\S(?=\s+\S)/gu)) out.push((m.index ?? 0) + m[0].length);
  return out;
}
