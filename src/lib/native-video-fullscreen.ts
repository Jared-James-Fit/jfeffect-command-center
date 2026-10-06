// One tap on a chat video → iOS's own full-screen player, already playing.
//
// Why not just our overlay: an inline <video playsinline> inside an overlay
// still starts paused in a small letterboxed player with an expand arrow, so
// the user taps twice (open, then expand) and a third time to play. WebKit's
// native player is what iMessage-style apps use. On iPhone it opens by itself
// when a video WITHOUT the `playsinline` attribute plays, and `play()` is only
// allowed to start sound/fullscreen inside the user's tap, so this must be
// called synchronously from the click handler with the final URL.

export function isIOSWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS reports as a Mac but is touch-capable.
  return navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
}

type WebKitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

/**
 * Plays `src` in the native iOS full-screen player. Returns false when this
 * platform doesn't do that (caller opens the in-app viewer instead). `onFail`
 * runs if the browser refused to start playback, so the caller can fall back.
 */
export function playNativeFullscreen(src: string, onFail?: () => void): boolean {
  if (typeof document === "undefined" || !isIOSWebKit()) return false;

  const v = document.createElement("video") as WebKitVideo;
  v.src = src;
  v.controls = true;
  v.preload = "auto";
  // Deliberately NOT playsInline: that attribute is what keeps iPhone from going full screen.
  v.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(v);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    try { v.pause(); } catch { /* noop */ }
    v.removeAttribute("src");
    try { v.load(); } catch { /* noop */ }
    v.remove();
  };

  // Closing the native player (Done / swipe down) ends fullscreen: drop the element.
  v.addEventListener("webkitendfullscreen", cleanup);
  v.addEventListener("error", () => { const was = !done; cleanup(); if (was) onFail?.(); });
  // iPadOS plays inline by default; ask for fullscreen once there's something to show.
  v.addEventListener("loadedmetadata", () => {
    if (!v.webkitDisplayingFullscreen) {
      try { v.webkitEnterFullscreen?.(); } catch { /* the play() path below still handles iPhone */ }
    }
  }, { once: true });

  const started = v.play();
  if (started && typeof started.catch === "function") {
    started.catch(() => {
      // Autoplay refused (or fullscreen interrupted before it began): let the caller fall back.
      const was = !done;
      if (!v.webkitDisplayingFullscreen) { cleanup(); if (was) onFail?.(); }
    });
  }
  return true;
}
