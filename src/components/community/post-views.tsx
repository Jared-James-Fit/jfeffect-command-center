import { useEffect, useState, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Eye, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/user-avatar";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { postTimeLabel, type CommunityAuthor, type CommunityPost } from "@/lib/community";

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

type Viewers = { count: number; viewers: (CommunityAuthor & { viewed_at: string })[]; private_count: number; me_private: boolean };

function usePostViewers(postId: string | null) {
  return useQuery({
    queryKey: ["community-post-viewers", postId],
    enabled: !!postId,
    staleTime: 15_000,
    queryFn: async (): Promise<Viewers> => {
      const { data, error } = await db.rpc("community_post_viewers", { _post_id: postId });
      if (error) throw error;
      return data as Viewers;
    },
  });
}

function useSetPrivateViews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await db.rpc("community_set_private_views", { _on: on });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community-post-viewers"] }),
  });
}

/**
 * Your own post: who's seen it, quietly ("3 faces · 24 views"). Only you
 * see this; tap for the list. Nothing shows until someone has.
 */
export function PostViewsRow({ post, onOpenAuthor }: { post: CommunityPost; onOpenAuthor?: (a: CommunityAuthor) => void }) {
  const [open, setOpen] = useState(false);
  const v = post.views;
  if (!post.is_mine || !v || v.count <= 0) return null;
  return (
    <>
      <button
        type="button"
        data-post-views
        onClick={() => setOpen(true)}
        className="mx-3.5 mb-2 flex items-center gap-2 rounded-full py-1 text-left text-[12px] text-muted-foreground active:opacity-70"
        aria-label={`Seen by ${v.count}. See who`}
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
        <span>
          <span className="font-bold text-foreground">{v.count}</span> {v.count === 1 ? "view" : "views"}
        </span>
      </button>
      <ViewersSheet postId={open ? post.id : null} onClose={() => setOpen(false)} onOpenAuthor={onOpenAuthor} />
    </>
  );
}

/** Who viewed your post, newest first; people who view privately are counted, not named. */
function ViewersSheet({ postId, onClose, onOpenAuthor }: { postId: string | null; onClose: () => void; onOpenAuthor?: (a: CommunityAuthor) => void }) {
  const { data, isLoading } = usePostViewers(postId);
  const setPrivate = useSetPrivateViews();
  return (
    <Sheet open={!!postId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[70dvh] gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 px-5 pb-3 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] font-black">Views{data ? ` · ${data.count}` : ""}</SheetTitle>
            <SheetDescription className="text-[12px]">Only you can see who viewed your post</SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>
        <div className="overflow-y-auto px-2 py-2">
          {isLoading && (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 rounded-xl" />
              ))}
            </div>
          )}
          {data?.viewers.map((a) => (
            <button
              key={a.user_id}
              type="button"
              disabled={!onOpenAuthor}
              onClick={() => {
                if (!onOpenAuthor) return;
                onClose();
                onOpenAuthor(a);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted disabled:hover:bg-transparent"
            >
              <UserAvatar src={a.avatar_url} name={a.name} size={38} expandable={false} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1 text-[14px] font-bold">
                  <span className="truncate">{a.name}</span>
                  {a.is_coach && <BadgeCheck className="h-4 w-4 shrink-0 fill-primary text-primary-foreground" aria-label="Coach" />}
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">{postTimeLabel(a.viewed_at)}</span>
            </button>
          ))}
          {data && data.private_count > 0 && (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">
              + {data.private_count} {data.private_count === 1 ? "person" : "people"} viewed privately
            </p>
          )}
        </div>
        {data && (
          <label className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">
            <span className="min-w-0">
              <span className="block text-[13px] font-bold">View posts privately</span>
              <span className="block text-[11px] text-muted-foreground">You still count as a view, without your name</span>
            </span>
            <Switch checked={data.me_private} disabled={setPrivate.isPending} onCheckedChange={(on) => setPrivate.mutate(on)} />
          </label>
        )}
      </SheetContent>
    </Sheet>
  );
}
