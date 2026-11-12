/**
 * The full-screen clips (ReelsViewer): every clip in the feed, one per
 * screen, swiped up and down. Pure, so the order and the window are tested.
 */
import { postSlides, type CommunityPost, type PostSlide } from "@/lib/community";

export type ReelItem = {
  /** Stable across refetches: the post and the clip's file. */
  key: string;
  postId: string;
  slide: PostSlide;
  /** Which of the post's clips this is (1-based), and how many it has. */
  clip: number;
  clips: number;
};

/** Every clip in a list of posts, in the list's order; a post's clips one after another (a workout film's sets). */
export function reelItems(posts: CommunityPost[]): ReelItem[] {
  const out: ReelItem[] = [];
  const seen = new Set<string>();
  for (const p of posts) {
    const clips = postSlides(p).filter((s) => s.type === "video");
    clips.forEach((slide, i) => {
      const key = `${p.id}:${slide.path}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, postId: p.id, slide, clip: i + 1, clips: clips.length });
    });
  }
  return out;
}

/** Where to open: the clip that was tapped, else the post's first clip, else the first. */
export function reelStart(items: ReelItem[], postId: string, path: string | null): number {
  const exact = items.findIndex((it) => it.postId === postId && it.slide.path === path);
  if (exact >= 0) return exact;
  const post = items.findIndex((it) => it.postId === postId);
  return post >= 0 ? post : 0;
}

/**
 * The clips that hold a real video element: the one on screen and the one
 * either side (so a swipe either way starts at once); the rest are their
 * poster. Three elements, reused page to page (REEL_SLOTS), so the sound a
 * tap allowed stays allowed on every swipe.
 */
export const REEL_SLOTS = 3;
export function reelLoaded(index: number, active: number): boolean {
  return Math.abs(index - active) <= 1;
}
/** The element a page uses: neighbours never share one. */
export function reelSlot(index: number): number {
  return ((index % REEL_SLOTS) + REEL_SLOTS) % REEL_SLOTS;
}

/** The page the scroller is on. */
export function reelIndexAt(scrollTop: number, pageHeight: number, count: number): number {
  if (!pageHeight || count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(scrollTop / pageHeight)));
}
