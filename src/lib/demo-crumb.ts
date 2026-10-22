/**
 * What happened when the app reloaded while a demo video was up. The page
 * notes it's playing a demo; a clean way out (closing it, going to the
 * background) clears or marks that, and anything that reloads the page
 * itself says why first (`noteReloadReason`). If the next launch finds a
 * fresh note with no clean exit, iOS ended the page (memory, or the media
 * stack); with a reason, the app reloaded itself. It's reported once as a
 * support alert, so a reload during a demo is read, not guessed.
 */
const KEY = "jf-demo-crumb";
/** A crash reload comes straight back; anything older is a closed app, not a crash. */
export const CRUMB_FRESH_MS = 2 * 60_000;

export type DemoCrumb = { at: number; path: string; url: string; exit: string | null };

const store = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};
const read = (): DemoCrumb | null => {
  try {
    const raw = store()?.getItem(KEY);
    return raw ? (JSON.parse(raw) as DemoCrumb) : null;
  } catch {
    return null;
  }
};
const write = (c: DemoCrumb) => {
  try {
    store()?.setItem(KEY, JSON.stringify(c));
  } catch {
    /* private mode */
  }
};

export function markDemoPlaying(url: string) {
  if (typeof window === "undefined") return;
  write({ at: Date.now(), path: window.location.pathname, url, exit: null });
}
export function clearDemoCrumb() {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* fine */
  }
}
/** The page is going away on purpose (pagehide) or to the background. */
export function noteDemoExit(exit: string) {
  const c = read();
  if (c && !c.exit) write({ ...c, exit });
}

let reloadReason: string | null = null;
/** Call right before any `location.reload()` the app does itself. */
export function noteReloadReason(reason: string) {
  reloadReason = reason;
  noteDemoExit(`reload: ${reason}`);
}
export const pendingReloadReason = () => reloadReason;

/** On launch: the note to report, if the last page died with a demo up (and it's taken either way). */
export function takeDemoCrumb(now = Date.now()): DemoCrumb | null {
  const c = read();
  clearDemoCrumb();
  return judgeDemoCrumb(c, now);
}

/** Pure: report a fresh note whose page didn't leave cleanly (or reloaded itself). */
export function judgeDemoCrumb(c: DemoCrumb | null, now: number): DemoCrumb | null {
  if (!c || typeof c.at !== "number" || now - c.at > CRUMB_FRESH_MS) return null;
  // gone to the background first (an app switch, or swiped away from there): not a reload
  if (c.exit === "background" || c.exit === "closed") return null;
  return c;
}

export function demoCrumbMessage(c: DemoCrumb): string {
  if (!c.exit) return "Demo video: the app reloaded while a demo was playing (iOS ended the page)";
  if (c.exit === "pagehide") return "Demo video: the app reloaded itself while a demo was playing (no reason given)";
  return `Demo video: the app reloaded itself while a demo was playing (${c.exit.replace(/^reload: /, "")})`;
}
