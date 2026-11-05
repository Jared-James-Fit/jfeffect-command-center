/**
 * The words shown before "… more" when a feed caption is cut at a clean stop
 * (NoteCaption). A sentence's period gives way to the ellipsis ("sneaky… more",
 * never "sneaky.… more"), and a ? or ! keeps its mark with a space before it.
 */
export function cutPreview(text: string, cut: number): { shown: string; gap: string } {
  const at = text.slice(0, cut).trimEnd();
  const shown = at.replace(/\.+$/, "");
  return { shown: shown || at, gap: /[!?]$/.test(shown) ? " " : "" };
}

/** The preview exactly as it reads, "… more" included: what NoteCaption measures. */
export function previewLine(text: string, cut: number): string {
  const { shown, gap } = cutPreview(text, cut);
  return `${shown}${gap}… more`;
}
