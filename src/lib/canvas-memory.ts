/**
 * iPhone Safari caps the memory all canvases on a page can hold together, and
 * a canvas keeps its pixels until the garbage collector gets round to it.
 * The share studio makes several full-size canvases per post (the camera
 * frame, the card, the feed image, stickers baked in, the resize and the
 * thumbnail); a few tries in one session and the next `getContext("2d")`
 * returns null, so the next draw throws and posting falls over. Shrinking a
 * canvas to 0×0 hands its memory back straight away.
 */
export function releaseCanvas(c: HTMLCanvasElement | null | undefined) {
  if (!c) return;
  try {
    c.width = 0;
    c.height = 0;
  } catch {
    /* already gone */
  }
}

/** A 2D context, or a clear error instead of a crash when the phone is out of image memory. */
export function context2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Your phone ran out of memory for photos. Close a few apps and try again.");
  return ctx;
}
