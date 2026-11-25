import { lazyWithRetry } from "@/lib/lazy-chunk";
import { preloadWhenIdle } from "@/lib/idle";

/*
 * A post's share sheets, opened by a tap (✈️, Share to Instagram) and mounted
 * on that first tap: loaded on their own instead of with every post card, and
 * fetched in idle time once a post has been on screen a few seconds, so the
 * first tap still opens them at once.
 */
export const PostShareSheet = lazyWithRetry(() =>
  import("@/components/community/post-share-sheet").then((m) => ({ default: m.PostShareSheet })),
);
export const InstagramShareSheet = lazyWithRetry(() =>
  import("@/components/community/instagram-share-sheet").then((m) => ({ default: m.InstagramShareSheet })),
);

/** The comments over a story (💬 in the story viewer), loaded on the first tap. */
export const CommentsSheet = lazyWithRetry(() =>
  import("@/components/community/comments-sheet").then((m) => ({ default: m.CommentsSheet })),
);

export function preloadShareSheets(instagram: boolean): void {
  preloadWhenIdle("post-share-sheet", () => PostShareSheet.preload(), 5000);
  if (instagram) preloadWhenIdle("instagram-share-sheet", () => InstagramShareSheet.preload(), 6000);
}
