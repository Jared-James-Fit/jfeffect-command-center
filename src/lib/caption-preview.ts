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
 * Where a preview may stop: the end of every word that more words follow
 * (ascending; the full length is never one). Reels' preview cuts at a word,
 * mid-sentence or not, and "… more" opens the rest.
 */
export function wordStops(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\S(?=\s+\S)/gu)) out.push((m.index ?? 0) + m[0].length);
  return out;
}

/**
 * A caption's paragraphs (Nov 21 2026): split on blank lines, each trimmed, a
 * single line break inside one kept (a list of names, a short line under a
 * longer one). Formatting is never collapsed: a caption written in short
 * paragraphs reads in short paragraphs everywhere it's shown whole.
 */
export function captionParagraphs(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/\n[ \t]*\n+/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => l.replace(/[ \t]+/g, " ").trim())
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean);
}

/**
 * The text a feed screen previews: each paragraph (and each line inside one)
 * on its own line, with no blank lines between, so a hook and what follows
 * never run together into one block, and the two lines a screen shows aren't
 * spent on an empty line.
 */
export function previewText(text: string): string {
  return captionParagraphs(text).join("\n");
}

/** A sentence-ending stop has to keep at least this share of what a word stop would show, or the word stop wins. */
export const SENTENCE_STOP_SHARE = 0.35;

/**
 * Where a feed screen's preview may stop, in the order it prefers them: the
 * end of a line or paragraph (the opening thought, whole), then the end of a
 * sentence, then the end of any word (Reels'). Each ascending.
 */
export function previewStops(text: string): { lines: number[]; sentences: number[]; words: number[] } {
  const lines: number[] = [];
  for (const m of text.matchAll(/\S(?=[ \t]*\n)/gu)) lines.push((m.index ?? 0) + m[0].length);
  const sentences: number[] = [];
  for (const m of text.matchAll(/[.!?…]+["”’)]*(?=\s+\S)/gu)) sentences.push((m.index ?? 0) + m[0].length);
  return { lines, sentences, words: wordStops(text) };
}

/** The last stop in an ascending list that `fits` (fits is monotone: more text never fits better), or -1. */
function latestFitting(stops: number[], fits: (stop: number) => boolean): number {
  let lo = 0;
  let hi = stops.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(stops[mid])) {
      best = stops[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/**
 * Where the preview stops: the latest line or paragraph end that fits (the
 * opener whole, never run into the next paragraph), else a sentence end that
 * fits when it keeps a fair share of the room (`SENTENCE_STOP_SHARE`), else
 * the last word that fits. -1 when not even a word fits (cut by lines).
 */
export function choosePreviewStop(text: string, fits: (stop: number) => boolean): number {
  const stops = previewStops(text);
  const line = latestFitting(stops.lines, fits);
  if (line > 0) return line;
  const word = latestFitting(stops.words, fits);
  const sentence = latestFitting(stops.sentences, fits);
  if (sentence > 0 && (word <= 0 || sentence >= word * SENTENCE_STOP_SHARE)) return sentence;
  return word;
}
