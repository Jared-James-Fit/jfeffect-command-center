import { useEffect, useState } from "react";
import { Check, Repeat2, Star, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActivitySpinner } from "@/components/activity-spinner";
import { PostTileFace, postThumbPath } from "@/components/community/post-tile";
import type { CommunityPost } from "@/lib/community";

/** Start loading the next page this far before the end of the grid comes on screen. */
export const GRID_PREFETCH_PX = 800;

type Pager = { hasNextPage?: boolean; isFetchingNextPage?: boolean; isFetchNextPageError?: boolean; fetchNextPage?: () => unknown };

/**
 * Instagram's profile grid: three across, edge to edge, portrait (3:4)
 * tiles with a hairline between them. More loads by itself well before you
 * reach the end, with Instagram's spinner under the grid only while a page
 * is on its way; once there's nothing more, the grid simply ends.
 * `picked` turns on selecting (a tick on each tile); `mark` puts a corner
 * mark on every tile (Reposts wears 🔁).
 */
export function PostGrid({ posts, urls, unit, onTap, picked, mark, pager, showAudience = false, edge = true }: {
  posts: CommunityPost[];
  urls: Record<string, string> | undefined;
  unit: "kg" | "lb";
  onTap: (p: CommunityPost) => void;
  picked?: Set<string> | null;
  mark?: "repost";
  pager?: Pager;
  /** The author's own grid: a lock / star on posts not shared with the whole crew. */
  showAudience?: boolean;
  /** Edge to edge on a phone (the page's side padding is cancelled). Off inside a sheet. */
  edge?: boolean;
}) {
  return (
    <>
      <div className={cn("grid grid-cols-3 gap-[2px]", edge && "-mx-3 sm:mx-0 sm:overflow-hidden sm:rounded-xl")} data-post-grid>
        {posts.map((p) => (
          <GridTile key={p.id} post={p} thumb={urls?.[postThumbPath(p) ?? ""] ?? null} unit={unit} onTap={onTap} picked={picked} mark={mark} showAudience={showAudience} />
        ))}
      </div>
      {pager && <GridMore pager={pager} />}
    </>
  );
}

function GridTile({ post: p, thumb, unit, onTap, picked, mark, showAudience }: {
  post: CommunityPost;
  thumb: string | null;
  unit: "kg" | "lb";
  onTap: (p: CommunityPost) => void;
  picked?: Set<string> | null;
  mark?: "repost";
  showAudience: boolean;
}) {
  const on = picked?.has(p.id) ?? false;
  return (
    <button
      type="button"
      onClick={() => onTap(p)}
      // 3:4, Instagram's grid since 2025: a portrait photo fills it with a little off the sides
      className="relative aspect-[3/4] w-full overflow-hidden bg-muted active:opacity-90"
      aria-pressed={picked ? on : undefined}
      aria-label={picked ? `${on ? "Selected" : "Select"} post` : `Open ${p.stats?.workout_title ?? p.session_title ?? "post"}`}
      data-grid-post
    >
      <PostTileFace post={p} thumb={thumb} unit={unit} />
      {mark === "repost" && <Repeat2 className="absolute right-1.5 top-1.5 h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]" strokeWidth={2.6} aria-hidden />}
      {showAudience && (p.visibility === "close_friends" ? (
        <Star className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 fill-emerald-400 text-emerald-400 drop-shadow" aria-label="Close friends" />
      ) : p.visibility !== "community" && p.visibility !== "followers" ? (
        <Lock className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 text-white drop-shadow" aria-label="Not shared with the crew" />
      ) : null)}
      {picked && (
        <>
          {on && <span className="absolute inset-0 bg-black/35" aria-hidden />}
          <span className={cn("absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-2 shadow", on ? "border-white bg-primary text-primary-foreground" : "border-white/90 bg-black/20")} aria-hidden>
            {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
        </>
      )}
    </button>
  );
}

/**
 * Under the grid: loads the next page when it gets near the screen (and
 * again right after, if the grid is still short of it), Instagram's spinner
 * while it loads, a quiet "Tap to try again" if it couldn't, and nothing at
 * all at the end.
 */
export function GridMore({ pager }: { pager: Pager }) {
  const near = useNearScreen<HTMLDivElement>(GRID_PREFETCH_PX);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = pager;
  useEffect(() => {
    if (!near.on || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    // the observer can still say "near" for a moment after a page lands and pushes the end
    // down: check where the end really is, so it never loads a page nobody's close to
    if (near.el && near.el.getBoundingClientRect().top > window.innerHeight + GRID_PREFETCH_PX) return;
    void fetchNextPage?.();
  }, [near.on, near.el, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  if (!hasNextPage) return null;
  return (
    <div ref={near.ref} className="flex h-16 items-center justify-center" data-grid-more={isFetchNextPageError ? "error" : isFetchingNextPage ? "loading" : "waiting"}>
      {isFetchNextPageError ? (
        <button type="button" onClick={() => void fetchNextPage?.()} className="h-9 rounded-full px-4 text-[13px] font-bold text-muted-foreground active:bg-muted">
          Couldn't load more. Tap to try again
        </button>
      ) : isFetchingNextPage ? (
        <span className="text-muted-foreground" role="status" aria-label="Loading more posts">
          <ActivitySpinner size={26} />
        </span>
      ) : null}
    </div>
  );
}

/** Whether an element is within `margin` px of the bottom of the screen (no IntersectionObserver = always). */
export function useNearScreen<T extends Element>(margin: number) {
  const [el, setEl] = useState<T | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!el) {
      setOn(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setOn(!!e?.isIntersecting), { rootMargin: `0px 0px ${margin}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [el, margin]);
  return { ref: setEl, on, el };
}

/** The grid before its first page lands: the same tiles, shimmering. */
export function GridSkeleton({ rows = 3, edge = true }: { rows?: number; edge?: boolean }) {
  return (
    <div className={cn("grid grid-cols-3 gap-[2px]", edge && "-mx-3 sm:mx-0 sm:overflow-hidden sm:rounded-xl")} aria-hidden data-grid-skeleton>
      {Array.from({ length: rows * 3 }).map((_, i) => (
        <div key={i} className="aspect-[3/4] w-full animate-pulse bg-muted" />
      ))}
    </div>
  );
}
