/**
 * The comment box's quick emoji, Instagram's row over the box: one tap puts
 * the emoji in where the cursor is (never sends it), so a comment can be
 * just "🔥" or "Strong 💪🔥".
 */
export const QUICK_COMMENT_EMOJI = ["❤️", "🙌", "🔥", "👏", "😢", "😍", "😮", "😂"] as const;

/**
 * `insert` put in at the cursor (`start`..`end` replaced; no cursor, at the
 * end), with a space before it when it would touch a word. Nothing changes
 * when it would run past `max`. Returns the text and where the cursor goes.
 */
export function insertAtCursor(
  value: string,
  insert: string,
  start: number | null | undefined,
  end: number | null | undefined,
  max: number,
): { text: string; cursor: number } {
  const a = start == null ? value.length : Math.max(0, Math.min(start, value.length));
  const b = end == null ? a : Math.max(a, Math.min(end, value.length));
  const before = value.slice(0, a);
  const add = before && /[\p{L}\p{N}]$/u.test(before) ? ` ${insert}` : insert;
  const text = before + add + value.slice(b);
  if (text.length > max) return { text: value, cursor: b };
  return { text, cursor: a + add.length };
}

