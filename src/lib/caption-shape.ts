/**
 * The shape an automated caption takes on a phone (Nov 21 2026): short
 * paragraphs with a blank line between them, the opening thought on its own
 * (it's what the feed's two lines show before "… more"). The writers are told
 * to write that way; this is the code's net for a model that hands back one
 * block anyway, like the dashes tidyText fixes. It never touches a caption
 * that already has paragraphs (that shape was chosen), never splits a short
 * one, never changes a word, and never makes a poem of one-sentence lines.
 * Pure, tested.
 */

/** Under this many characters a block reads fine as one paragraph. */
export const SHAPE_MIN_CHARS = 200;
/** What follows the opener stays one paragraph up to this; past it, it splits once where a new thought starts. */
export const SHAPE_REST_MAX = 260;

/**
 * A sentence that leans on the one before it ("If not, …", "It was bad
 * timing.", "That's the point."): never the start of a paragraph.
 */
const LEANS_BACK = /^(if not|if so|otherwise|then|so|but|and|or|that|this|it|it's|its|they|those|these|which|same|also|plus|still|even|because|cool|nope|yes|no)\b/i;

/**
 * A block's sentences: each ends at . ! ? or … with a space and more words
 * after it (a decimal, "2.5", never splits). Nothing in the text changes:
 * joined back with single spaces they're the block again.
 */
export function captionSentences(block: string): string[] {
  const t = block.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out: string[] = [];
  let start = 0;
  for (const m of t.matchAll(/[.!?…]+["”’)]*(?= +\S)/gu)) {
    const end = (m.index ?? 0) + m[0].length;
    out.push(t.slice(start, end).trim());
    start = end;
  }
  const rest = t.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * A caption written as one block, in short paragraphs: the opening sentence
 * alone (it's the line the feed shows), the rest as one paragraph, split once
 * more only when it runs long, at the sentence boundary nearest its middle
 * that starts a new thought (LEANS_BACK). Anything already in paragraphs or
 * on lines of its own, under `SHAPE_MIN_CHARS`, or under three sentences
 * comes back as it was. Conservative on purpose: the writer chooses the
 * shape; this only keeps a wall from reaching the feed.
 */
export function shapeCaption(text: string): string {
  const t = String(text ?? "").replace(/\r/g, "").trim();
  if (!t || t.includes("\n") || t.length < SHAPE_MIN_CHARS) return t;
  const sentences = captionSentences(t);
  if (sentences.length < 3) return t;
  const [first, ...rest] = sentences;
  // the opener stands alone only when the next sentence doesn't lean on it
  if (LEANS_BACK.test(rest[0])) return t;
  const body = rest.join(" ");
  if (body.length <= SHAPE_REST_MAX || rest.length < 3) return `${first}\n\n${body}`;
  // the one place the rest splits: nearest its middle, before a sentence that starts something new
  let best = -1;
  let bestGap = Infinity;
  let at = 0;
  for (let i = 1; i < rest.length; i++) {
    at += rest[i - 1].length + 1;
    if (LEANS_BACK.test(rest[i])) continue;
    const gap = Math.abs(at - body.length / 2);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  if (best < 0) return `${first}\n\n${body}`;
  return [first, rest.slice(0, best).join(" "), rest.slice(best).join(" ")].join("\n\n");
}
