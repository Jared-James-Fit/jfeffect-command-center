/**
 * A heads-up when the phone won't let videos start by themselves (Nov 22 2026).
 *
 * An iPhone in Low Power Mode refuses every video that isn't started from a
 * tap, even a muted one, so Crew's clips and stories stop playing on their own.
 * A web page can't read Low Power Mode, but it can see what it does: a muted
 * play() refused with NotAllowedError. The first time that happens the app
 * says why, once, in a toast that never blocks anything, and the clip's own
 * play button does the rest. Shown at most once a launch and not again on
 * this phone for NOTICE_GAP_MS (Low Power Mode comes and goes; a reminder a
 * week is a heads-up, more is nagging).
 *
 * The toast is loaded when it's shown (sonner is in the app's main bundle
 * already), so the video pool that calls this never pulls sonner's styles in.
 */
export const NOTICE_KEY = "jf-autoplay-notice";
export const NOTICE_GAP_MS = 7 * 24 * 60 * 60 * 1000;

export type NoticeState = {
  /** Already shown since the app opened. */
  shownThisLaunch: boolean;
  /** When it was last shown on this phone (ms), null if never. */
  lastShownAt: number | null;
  /** The app is on screen (a refusal while it's away or coming back isn't the phone saving power). */
  visible: boolean;
};

export function shouldShowAutoplayNotice(s: NoticeState, now: number): boolean {
  if (s.shownThisLaunch || !s.visible) return false;
  return s.lastShownAt == null || now - s.lastShownAt >= NOTICE_GAP_MS;
}

/** The words, by phone: an iPhone's cause is Low Power Mode; elsewhere a battery or data saver. */
export function autoplayNoticeWords(ios: boolean): { title: string; body: string } {
  return ios
    ? {
        title: "Videos need a tap right now",
        body: "Low Power Mode is usually why. Tap a video to play it, or turn Low Power Mode off in Settings → Battery.",
      }
    : {
        title: "Videos need a tap right now",
        body: "Your phone's battery or data saver is usually why. Tap a video to play it.",
      };
}

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

function readLast(): number | null {
  try {
    const raw = window.localStorage.getItem(NOTICE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLast(at: number) {
  try {
    window.localStorage.setItem(NOTICE_KEY, String(at));
  } catch {
    /* private window or blocked storage: once a launch still holds */
  }
}

let shownThisLaunch = false;

/** A video the phone wouldn't start, even muted. Says why once, if it's time to. */
export function noteAutoplayRefused(now = Date.now()) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const state: NoticeState = {
    shownThisLaunch,
    lastShownAt: readLast(),
    visible: document.visibilityState === "visible",
  };
  if (!shouldShowAutoplayNotice(state, now)) return;
  shownThisLaunch = true;
  writeLast(now);
  const words = autoplayNoticeWords(isIosDevice());
  return import("sonner")
    .then(({ toast }) => {
      toast(words.title, {
        id: NOTICE_KEY,
        description: words.body,
        duration: 9000,
        action: { label: "Got it", onClick: () => {} },
      });
    })
    .catch(() => {
      /* a chunk gone after a publish: the play button still says it */
    });
}

/** Tests only. */
export function resetAutoplayNotice() {
  shownThisLaunch = false;
}
