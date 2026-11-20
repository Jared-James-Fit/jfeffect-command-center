/**
 * Copy text that's still on its way (a server function's answer) from inside
 * the tap that asked for it. iPhones only let the tap itself start a clipboard
 * write, so the write starts now with a ClipboardItem holding the promise and
 * fills in when the text arrives; where that isn't supported, the text is
 * written once it's here (desktop browsers allow that for a few seconds after
 * a click). Never throws.
 */
export async function copyWhenReady(text: Promise<string>): Promise<boolean> {
  const CI = (globalThis as unknown as { ClipboardItem?: new (items: Record<string, Blob | Promise<Blob>>) => ClipboardItem }).ClipboardItem;
  if (CI && typeof navigator !== "undefined" && navigator.clipboard?.write) {
    try {
      const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
      await navigator.clipboard.write([new CI({ "text/plain": blob })]);
      return true;
    } catch {
      /* fall back below */
    }
  }
  try {
    await navigator.clipboard.writeText(await text);
    return true;
  } catch {
    return false;
  }
}
