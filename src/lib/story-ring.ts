import { crewStories, myStory, type CommunityPost, type StoryGroup } from "@/lib/community";

/**
 * How a person's photo is ringed for you, everywhere it shows (Nov 22 2026),
 * Instagram's way:
 *  - "none": no story up (nothing posted in the last day, or it ran out or
 *    was deleted): a plain photo, never a decorative ring;
 *  - "unseen": a story with a moment you haven't watched: the brand ring;
 *  - "close_friends": the moment you haven't watched is Close Friends: green;
 *  - "seen": you've watched all of it: a quiet grey ring.
 *
 * Read only from the stories actually up (the same last day the story rail
 * reads, storyWorthy + the 24h window), so a ring is never hardcoded and an
 * expired story loses its ring by itself.
 */
export type StoryRingState = "none" | "unseen" | "close_friends" | "seen";

type RingPost = Pick<CommunityPost, "id" | "created_at" | "auto" | "stats" | "visibility" | "is_mine" | "seen" | "author"> & {
  story?: boolean;
  series?: string | null;
};

/**
 * Every person with a story up, and how their ring reads. `seen` is what
 * this viewer has watched that the server doesn't know yet (this visit), and
 * their own moments they've watched on this phone: views never count the
 * author's own, so "you've seen your own story" lives on the device.
 */
export function storyRings<T extends RingPost>(posts: T[], opts: { now?: number; seen?: ReadonlySet<string> } = {}): Map<string, StoryRingState> {
  const now = opts.now ?? Date.now();
  const seen = opts.seen ?? new Set<string>();
  const out = new Map<string, StoryRingState>();
  const mine = myStory(posts, now);
  if (mine) out.set(mine.author.user_id, mine.items.some((p) => !seen.has(p.id)) ? "unseen" : "seen");
  for (const g of crewStories(posts, now)) out.set(g.author.user_id, groupRing(g.items, seen));
  return out;
}

/** Someone else's story: grey once every moment is watched (by the server or this visit), green when what's new is Close Friends. */
export function groupRing(items: Pick<CommunityPost, "id" | "seen" | "visibility">[], seen: ReadonlySet<string>): StoryRingState {
  const fresh = items.filter((p) => !p.seen && !seen.has(p.id));
  return !fresh.length ? "seen" : fresh.some((p) => p.visibility === "close_friends") ? "close_friends" : "unseen";
}

/** One person's story (yours or theirs) to play from their photo, or null when they have nothing up. */
export function storyGroupFor<T extends RingPost>(posts: T[], userId: string, now = Date.now()): StoryGroup<T> | null {
  const mine = myStory(posts, now);
  if (mine && mine.author.user_id === userId) return mine;
  return crewStories(posts, now).find((g) => g.author.user_id === userId) ?? null;
}

/**
 * The ring's stroke and the gap between it and the photo, by the photo's
 * size: thin on a 32px comment face, a little heavier on a profile's 78px.
 * The ring sits outside the photo, so it never changes the photo's size or
 * the row's layout.
 */
export function ringGeometry(size: number): { stroke: number; gap: number } {
  if (size <= 36) return { stroke: 1.5, gap: 1.5 };
  if (size <= 60) return { stroke: 2, gap: 2 };
  return { stroke: 2.5, gap: 3 };
}
