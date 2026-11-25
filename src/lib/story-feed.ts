/**
 * "Share to feed" on your own story (Nov 25 2026), pure and tested in
 * story-interactions.test.ts. A story never becomes a feed post by itself
 * (storyWorthy, community.ts): the poster chooses it, from the story's ⋯
 * menu, and the feed gets its own copy with its own files, so deleting the
 * story (which removes its files) never empties the post. The story stays up.
 */
import { postSlides, type CommunityPost, type PostSlide } from "@/lib/community";

export type StoryFeedVerdict = { ok: true; audience: "community" | "followers" } | { ok: false; reason: string };

type StoryFeedPost = Pick<
  CommunityPost,
  "is_mine" | "story" | "auto" | "series" | "kind" | "visibility" | "media_path" | "media_type" | "shared_post" | "archived_at"
>;

/**
 * Whether this story can go to the feed, and for whom:
 *  - only your own, made as a story (never a lesson, a Pulse or any workout card: a workout that is
 *    only its generated card is never in the feed, isWorkoutCard / AGENTS.md "Crew is what people post");
 *  - with a photo or clip of its own, never one that only carries another post's card (Repost is for that);
 *  - for the crew, or for a private account's followers; a Close friends story stays with them.
 */
export function storyFeedVerdict(p: StoryFeedPost): StoryFeedVerdict {
  if (!p.is_mine) return { ok: false, reason: "Only your own story can go to your feed" };
  if (!p.story || p.auto || p.series === "lesson" || p.kind === "workout") {
    return { ok: false, reason: "A workout card on its own stays on your story. Post a photo or clip from your workout to share it to Crew" };
  }
  if (p.archived_at) return { ok: false, reason: "That story isn't up any more" };
  if (p.shared_post) return { ok: false, reason: "This story shows a post. Share that post to your feed instead" };
  if (!p.media_path || !p.media_type) return { ok: false, reason: "Only a story with a photo or clip can go to your feed" };
  if (p.visibility === "community") return { ok: true, audience: "community" };
  if (p.visibility === "followers") return { ok: true, audience: "followers" };
  return { ok: false, reason: "A Close friends story stays with Close friends" };
}

/** A story's file, as the feed's own copy of it: under the poster's folder, never the same name. */
export function feedCopyPath(path: string, userId: string, stamp: number, nonce: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot > path.lastIndexOf("/") && dot >= 0 ? path.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  return `${userId}/${stamp}-${nonce}-feed${ext}`;
}

/** Every file a story points at, once each (the cover, its poster, every slide), in the order they're copied. */
export function storyFilesToCopy(slides: PostSlide[]): string[] {
  return [...new Set(slides.flatMap((s) => [s.path, s.thumb]).filter((p): p is string => !!p))];
}

/** The feed post's media: the story's slides, same order, shape and framing, each pointing at its own copy. */
export function feedMedia(post: Parameters<typeof postSlides>[0], copies: Map<string, string>): PostSlide[] {
  return postSlides(post).map((s) => ({
    ...s,
    path: copies.get(s.path) ?? s.path,
    thumb: s.thumb ? (copies.get(s.thumb) ?? s.thumb) : null,
  }));
}
