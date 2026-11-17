/**
 * Whether the app's own camera is up. While it is, the phone may be turned on
 * its side to film (PortraitOnly steps aside and Android's portrait lock is
 * let go), and it's put back the moment the camera closes.
 */
export const CAMERA_OPEN_EVENT = "jf:camera-open";

let open = 0;

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
  if (open > 0) root.setAttribute("data-camera-open", "");
  else root.removeAttribute("data-camera-open");
  try {
    window.dispatchEvent(new CustomEvent(CAMERA_OPEN_EVENT, { detail: open > 0 }));
  } catch {
    /* no window (tests) */
  }
}
