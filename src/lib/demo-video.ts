/**
 * The player URL for an exercise demo. It only loads once someone taps Play
 * (`autoplay`: that tap starts it, with sound; the iPhone app needs no second
 * tap, a browser may show the player's own play button). Never muted, never
 * autoplaying on its own; plays inline (no forced fullscreen); YouTube without cookies.
 */
export function demoEmbedUrl(url: string, opts: { autoplay?: boolean } = {}): string {
  const raw = url.trim();
  const play = opts.autoplay ? "&autoplay=1" : "";
  const yt = raw.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?playsinline=1&rel=0&modestbranding=1${play}`;
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
    if (opts.autoplay) u.searchParams.set("autoplay", "1");
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
