import { useSyncExternalStore } from "react";
import { pickWorkoutWin, storyFrameKind, storyWords, type CommunityPost } from "@/lib/community";
import { extraLesson, hookLine } from "@/lib/lessons";

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

/**
 * Instagram's "Add to your story" (the ✈️ on a post, or on a story that's a
 * post): the story camera opens on a backdrop with the post as a card on it,
 * to write on and post to your story. The story keeps which post it shares,
 * so "View post" on it opens that post. Only offered where the Crew screen's
 * host is mounted (storyShareReady), never in a coach's View as client.
 */
export type StoryShare = { post: CommunityPost };

/**
 * What the shared post's card says, from the post alone: a lesson's title and
 * its hook, a workout's win and the session (in your unit), a words post's
 * words, a photo's caption under it. Never a program or block name (a
 * session's title only shows when the athlete named the workout).
 */
export function shareCardWords(post: CommunityPost, unit: "kg" | "lb"): { title: string | null; body: string | null } {
  const caption = post.caption?.trim() || null;
  const kind = storyFrameKind(post);
  if (kind === "lesson") {
    const l = extraLesson(post);
    return { title: l?.title ?? (hookLine(caption) || null), body: l ? hookLine(caption) || null : null };
  }
  if (kind === "win" && post.stats) {
    const win = pickWorkoutWin(post.stats, unit);
    const title = win.kind === "pr" ? `${win.headline} PR` : win.headline;
    return { title: win.detail ? `${title}\n${win.detail}` : title, body: caption };
  }
  if (kind === "media") return { title: null, body: caption };
  const w = storyWords(post);
  return { title: w.text, body: w.by ? `— ${w.by}` : null };
}

export const STORY_SHARE_EVENT = "jf:story-share";

let shareHosts = 0;
const shareListeners = new Set<() => void>();
const emitShare = () => shareListeners.forEach((l) => l());
/** The host is on screen (the Crew screen, someone who can post): Add to your story can be offered. */
export function storyShareReady(): boolean {
  return shareHosts > 0;
}
export function subscribeStoryShare(l: () => void): () => void {
  shareListeners.add(l);
  return () => void shareListeners.delete(l);
}
export function registerStoryShareHost(): () => void {
  shareHosts += 1;
  emitShare();
  return () => {
    shareHosts = Math.max(0, shareHosts - 1);
    emitShare();
  };
}

/** Whether Add to your story can be offered here (it follows the host on and off screen). */
export function useStoryShareReady(): boolean {
  return useSyncExternalStore(subscribeStoryShare, storyShareReady, () => false);
}

export function openStoryShare(s: StoryShare) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StoryShare>(STORY_SHARE_EVENT, { detail: s }));
}
