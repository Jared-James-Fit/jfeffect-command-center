import { Suspense, useCallback, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { StoryHostContext, type StoryHost } from "@/components/community/story-ring";
import { storyGroupFor, storyRings } from "@/lib/story-ring";
import { useSeenStories, useStoryClock } from "@/lib/story-seen";
import { communityKeys, useViewerUnit } from "@/lib/community.queries";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import type { CommunityAuthor, CommunityFeedPage, CommunityPost, StoryGroup } from "@/lib/community";
import { lazyWithRetry } from "@/lib/lazy-chunk";

// the story viewer only loads when a story is actually played from outside Crew
// (a chunk that won't load after a publish shows nothing: the photo's tap simply didn't open)
const PersonStory = lazyWithRetry(() => import("@/components/community/crew-stories").then((m) => ({ default: m.PersonStory })), { fallback: () => null });

const EMPTY: CommunityPost[] = [];

/**
 * Story rings outside Crew (Messages and every chat list), Nov 22 2026: the
 * same rings the Crew draws, read from the crew's last day already on the
 * phone (the story rail's own query, never a request of its own: every launch
 * opens on Crew, so it's there), and a ringed photo plays that person's story
 * right where it is. "View post" and a profile go to Crew. The Crew screen
 * has its own host inside this one (StoryHostProvider), which wins there.
 * Nothing rings while a coach views as a client (the crew in the cache is
 * the coach's own).
 */
export function GlobalStoryHost({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { user, role } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const subscribe = useCallback((cb: () => void) => qc.getQueryCache().subscribe(cb), [qc]);
  const data = useSyncExternalStore(
    subscribe,
    () => qc.getQueryData<InfiniteData<CommunityFeedPage>>(communityKeys.feed(null)),
    () => undefined,
  );
  const posts = useMemo(() => (isImpersonating || !data ? EMPTY : data.pages.flatMap((p) => p.posts)), [data, isImpersonating]);
  const seen = useSeenStories();
  const now = useStoryClock();
  const rings = useMemo(() => storyRings(posts, { seen, now }), [posts, seen, now]);
  const [playing, setPlaying] = useState<{ group: StoryGroup<CommunityPost>; posts: CommunityPost[] | null } | null>(null);
  const postsRef = useRef(posts);
  postsRef.current = posts;
  const staff = role === "admin" || role === "coach";
  const crew = staff ? "/admin/community" : "/portal/community";
  const navigate = useNavigate();
  const host = useMemo<StoryHost>(
    () => ({
      ring: (id) => rings.get(id) ?? "none",
      open: (id) => {
        const group = storyGroupFor(postsRef.current, id);
        if (!group) return false;
        setPlaying({ group, posts: null });
        return true;
      },
      play: (group, extra) => setPlaying({ group, posts: extra }),
    }),
    [rings],
  );
  const { data: unit } = useViewerUnit(playing ? user?.id : null);
  const go = (hash: string) => void navigate({ to: crew, hash });
  return (
    <StoryHostContext.Provider value={host}>
      {children}
      {playing && (
        <Suspense fallback={null}>
          <PersonStory
            group={playing.group}
            posts={playing.posts ?? posts}
            unit={unit ?? "lb"}
            viewerIsStaff={staff && !isImpersonating}
            onClose={() => setPlaying(null)}
            onOpenPost={(id) => go(`post=${id}`)}
            onJumpTo={(id) => go(`at=${id}`)}
            onOpenPerson={(a: CommunityAuthor) => go(`person=${a.user_id}`)}
          />
        </Suspense>
      )}
    </StoryHostContext.Provider>
  );
}
