/**
 * The player URL for an exercise demo. Never autoplays: iOS only lets an
 * embedded player autoplay *muted*, which is exactly the "no sound" people
 * hit, so the demo waits for a tap on its own play button and then plays
 * with sound. Plays inline (no forced fullscreen); YouTube without cookies.
 */
export function demoEmbedUrl(url: string): string {
  const raw = url.trim();
  const yt = raw.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?playsinline=1&rel=0&modestbranding=1`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (/(^|\.)vimeo\.com$/i.test(u.hostname) && !/^player\./i.test(u.hostname)) {
    const id = u.pathname.match(/(\d{5,})/)?.[1];
    if (id) u = new URL(`https://player.vimeo.com/video/${id}?title=0&byline=0&portrait=0&badge=0&dnt=1`);
  }
  if (/^player\.vimeo\.com$/i.test(u.hostname)) {
    for (const k of ["autoplay", "muted", "background", "loop", "autopause"]) u.searchParams.delete(k);
    u.searchParams.set("playsinline", "1");
    return u.toString();
  }
  return raw;
}

const ORIGINS = ["https://player.vimeo.com", "https://i.vimeocdn.com", "https://f.vimeocdn.com", "https://vod-adaptive-ak.vimeocdn.com"];
let warmed = false;
/** Open the connections to Vimeo before the player asks (on the How To touch-down). */
export function warmDemoPlayer() {
  if (warmed || typeof document === "undefined") return;
  warmed = true;
  for (const href of ORIGINS) {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = href;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
}
