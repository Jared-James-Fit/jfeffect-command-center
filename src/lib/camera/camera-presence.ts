/**
 * Whether the app's own camera is up. While it is, the phone may be turned on
 * its side to film (Android's portrait lock is let go, PortraitLock), and
 * it's put back the moment the camera closes. It's also full
 * screen the way TikTok's is: the status bar and everything behind the camera
 * are black (`data-camera-open` in styles.css, and `theme-color` for the
 * iPhone home-screen app's solid status bar), never a strip of the page's
 * light grey over the top of the picture or under its foot.
 */
export const CAMERA_OPEN_EVENT = "jf:camera-open";
/** The status bar's colour while the camera's up. */
export const CAMERA_THEME_COLOR = "#000000";

let open = 0;
let themeBefore: string | null = null;

/** The solid status bar (iPhone home-screen app, Android) black while the camera's up, the page's own colour after. */
function paintThemeColor(on: boolean) {
  const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
  if (on) {
    if (themeBefore == null) themeBefore = metas[0]?.getAttribute("content") ?? "";
    metas.forEach((m) => m.setAttribute("content", CAMERA_THEME_COLOR));
    return;
  }
  const before = themeBefore;
  themeBefore = null;
  // Crew's paged feed keeps its own black; a theme switched meanwhile has written its own colour
  if (!before || document.documentElement.classList.contains("feed-paging")) return;
  metas.forEach((m) => {
    if (m.getAttribute("content") === CAMERA_THEME_COLOR) m.setAttribute("content", before);
  });
}

export function isCameraOpen(): boolean {
  return open > 0;
}

/** Marks the camera open; returns the function that marks it closed again (once). */
export function holdCameraOpen(): () => void {
  open += 1;
  sync();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    open = Math.max(0, open - 1);
    sync();
  };
}

function sync() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const was = root.hasAttribute("data-camera-open");
  if (open > 0) root.setAttribute("data-camera-open", "");
  else root.removeAttribute("data-camera-open");
  if (was !== open > 0) paintThemeColor(open > 0);
  try {
    window.dispatchEvent(new CustomEvent(CAMERA_OPEN_EVENT, { detail: open > 0 }));
  } catch {
    /* no window (tests) */
  }
}
