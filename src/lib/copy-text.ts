/**
 * Copy text that may still be loading (a link minted by the server). Handing the clipboard
 * a promise keeps the tap's user gesture alive, so Safari on iPhone still allows the copy;
 * writing after an await does not. Mirrors copyImageToClipboard in workout-share-card.
 */
export async function copyTextToClipboard(text: string | Promise<string>): Promise<void> {
  const CI = (globalThis as unknown as {
    ClipboardItem?: new (items: Record<string, Blob | Promise<Blob>>) => ClipboardItem;
  }).ClipboardItem;
  if (CI && navigator.clipboard?.write) {
    const blob = Promise.resolve(text).then((t) => new Blob([t], { type: "text/plain" }));
    try {
      await navigator.clipboard.write([new CI({ "text/plain": blob })]);
      return;
    } catch (e) {
      // A failure to produce the text is the real error; anything else falls back below.
      await blob;
      if (!navigator.clipboard?.writeText) throw e;
    }
  }
  await navigator.clipboard.writeText(await text);
}
