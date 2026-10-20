import { useEffect, useState, type RefObject } from "react";
import { Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { UserAvatar } from "@/components/user-avatar";
import { PostActivitySheet } from "@/components/community/post-activity";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { type CommunityAuthor, type CommunityPost } from "@/lib/community";

const db = supabase as any;

/** On screen this long, half of it at least, counts as seen. */
export const VIEW_DWELL_MS = 2000;
export const VIEW_VISIBLE = 0.5;

// Seen this app session (never sent twice), and waiting to go (one call for a few).
const sent = new Set<string>();
const pending = new Set<string>();
let flushTimer: number | undefined;

function flush() {
  flushTimer = undefined;
  const ids = [...pending].slice(0, 50);
  ids.forEach((id) => pending.delete(id));
  if (!ids.length) return;
  void db.rpc("community_mark_viewed", { _post_ids: ids }).then(({ error }: { error: unknown }) => {
    // a failed send can go again next time it's on screen
    if (error) ids.forEach((id) => sent.delete(id));
  });
  if (pending.size) flushTimer = window.setTimeout(flush, 1500);
}

/** Count a view (once per post per session; the database keeps it to one per person). */
export function markPostViewed(postId: string) {
  if (sent.has(postId)) return;
  sent.add(postId);
  pending.add(postId);
  if (flushTimer === undefined) flushTimer = window.setTimeout(flush, 1500);
}

/**
 * Counts a view of `post` once `ref` has been at least half on screen for
 * two seconds. Never your own post, and never while a coach views as a
 * client (that isn't the client looking).
 */
export function usePostViewTracker(ref: RefObject<HTMLElement | null>, post: Pick<CommunityPost, "id" | "is_mine">) {
  const { isImpersonating } = useClientImpersonation();
  const skip = post.is_mine || isImpersonating;
  useEffect(() => {
    const el = ref.current;
    if (!el || skip || sent.has(post.id) || typeof IntersectionObserver === "undefined") return;
    let timer: number | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        window.clearTimeout(timer);
        if (!e.isIntersecting || e.intersectionRatio < VIEW_VISIBLE) return;
        timer = window.setTimeout(() => {
          markPostViewed(post.id);
          io.disconnect();
        }, VIEW_DWELL_MS);
      },
      { threshold: [0, VIEW_VISIBLE] },
    );
    io.observe(el);
    return () => {
      window.clearTimeout(timer);
      io.disconnect();
    };
  }, [ref, post.id, skip]);
}

/** Opening a post counts straight away. */
export function useViewOnOpen(post: Pick<CommunityPost, "id" | "is_mine"> | null | undefined) {
  const { isImpersonating } = useClientImpersonation();
  useEffect(() => {
    if (post && !post.is_mine && !isImpersonating) markPostViewed(post.id);
  }, [post, isImpersonating]);
}

/**
 * How many have seen a post, quietly ("24 views"), on every post. Your own
 * also shows who (3 faces); tap for its Activity (views, likes, shares,
 * reposts and who), which only you can open. Nothing shows until someone has.
 */
export function PostViewsRow({ post, onOpenAuthor }: { post: CommunityPost; onOpenAuthor?: (a: CommunityAuthor) => void }) {
  const [open, setOpen] = useState(false);
  const v = post.views;
  if (!v || v.count <= 0) return null;
  const label = (
    <span>
      <span className="font-bold text-foreground">{v.count}</span> {v.count === 1 ? "view" : "views"}
    </span>
  );
  // someone else's post: just the number
  if (!post.is_mine)
    return (
      <div data-post-views className="mx-3.5 mb-2 flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
        <Eye className="h-4 w-4 shrink-0" />
        {label}
      </div>
    );
  return (
    <>
      <button
        type="button"
        data-post-views
        onClick={() => setOpen(true)}
        className="mx-3.5 mb-2 flex items-center gap-2 rounded-full py-1 text-left text-[12px] text-muted-foreground active:opacity-70"
        aria-label={`Seen by ${v.count}. See activity`}
      >
        {v.faces.length > 0 ? (
          <span className="flex shrink-0 -space-x-1.5">
            {v.faces.slice(0, 3).map((a) => (
              <span key={a.user_id} className="rounded-full ring-2 ring-card">
                <UserAvatar src={a.avatar_url} name={a.name} size={20} expandable={false} />
              </span>
            ))}
          </span>
        ) : (
          <Eye className="h-4 w-4 shrink-0" />
        )}
        {label}
      </button>
      <PostActivitySheet postId={open ? post.id : null} onClose={() => setOpen(false)} onOpenAuthor={onOpenAuthor} />
    </>
  );
}
