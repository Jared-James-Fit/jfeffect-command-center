/**
 * Replying to a response to your question with a story (Instagram's "Share
 * response"): the responses sheet asks for it, the story viewer gets out of
 * the way, and the Crew screen's StoryReplyHost opens the story camera on a
 * backdrop with the response card on it. Posting marks the response answered.
 */

export type StoryReply = {
  /** The story with the question on it. */
  postId: string;
  question: string;
  /** Who sent it (only ever the poster's to know; the card never shows it). */
  userId: string;
  answer: string;
};

export const STORY_REPLY_EVENT = "jf:story-reply";

export function openStoryReply(r: StoryReply) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StoryReply>(STORY_REPLY_EVENT, { detail: r }));
}

/** The backdrops a reply can sit on (tap the colour button for the next), as top → bottom gradients. */
export const REPLY_BACKDROPS: [string, string][] = [
  ["#ef3340", "#7c0a14"],
  ["#111114", "#3a0d12"],
  ["#f97316", "#be123c"],
  ["#2563eb", "#111827"],
  ["#16a34a", "#064e3b"],
  ["#a855f7", "#4c1d95"],
];

/** A 1080×1920 story backdrop (a canvas, so the story camera treats it like a frozen photo). */
export function paintReplyBackdrop(i: number): HTMLCanvasElement {
  const [top, bottom] = REPLY_BACKDROPS[((i % REPLY_BACKDROPS.length) + REPLY_BACKDROPS.length) % REPLY_BACKDROPS.length];
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1920;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}
