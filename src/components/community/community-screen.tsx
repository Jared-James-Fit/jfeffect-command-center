import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PostCard, AuthorLine } from "@/components/community/post-card";
import { CommentsSheet } from "@/components/community/comments-sheet";
import { useCommunityFeed, useDeletePost, usePostMediaUrls, useReact } from "@/lib/community.queries";
import type { CommunityAuthor, CommunityPost, ReactionKey } from "@/lib/community";
import { cn } from "@/lib/utils";

type Scope = { kind: "everyone" } | { kind: "mine" } | { kind: "author"; author: CommunityAuthor };

/**
 * The Community feed: workouts people chose to share, newest first. Shared by
 * the client portal and the coach view. Quiet by design — no counts of
 * followers, no ranking, nothing that rewards posting for its own sake.
 */
export function CommunityScreen() {
  const { user, role } = useAuth();
  const viewerIsStaff = role === "admin" || role === "coach";
  const [scope, setScope] = useState<Scope>({ kind: "everyone" });
  const [commentsFor, setCommentsFor] = useState<CommunityPost | null>(null);

  const authorUserId = scope.kind === "mine" ? user?.id ?? null : scope.kind === "author" ? scope.author.user_id : null;
  const feed = useCommunityFeed(authorUserId);
  const posts = useMemo(() => feed.data?.pages.flatMap((p) => p.posts) ?? [], [feed.data]);
  const { data: urls } = usePostMediaUrls(posts);
  const del = useDeletePost();

  // Viewer's own unit for loads (athletes: their setting; coaches: app default).
  const { data: unit = "lb" } = useQuery({
    queryKey: ["community-unit", user?.id],
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<"kg" | "lb"> => {
      const { data } = await supabase.from("clients").select("preferred_weight_unit").eq("user_id", user!.id).maybeSingle();
      return (data as any)?.preferred_weight_unit === "kg" ? "kg" : "lb";
    },
  });

  // Infinite scroll: load the next page when the sentinel nears the viewport.
  const sentinel = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, posts.length]);

  const notAllowed = (feed.error as any)?.code === "42501";

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-3 px-3 pb-10 pt-3 sm:px-4">
      {scope.kind === "author" ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-full" onClick={() => setScope({ kind: "everyone" })} aria-label="Back to community">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <AuthorLine author={scope.author} sub="Shared workouts" />
        </div>
      ) : (
        <div className="inline-flex rounded-full bg-muted p-1" role="tablist" aria-label="Community view">
          {(["everyone", "mine"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={scope.kind === k}
              onClick={() => setScope({ kind: k })}
              className={cn(
                "h-9 rounded-full px-4 text-[13px] font-bold transition-colors",
                scope.kind === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {k === "everyone" ? "Community" : "My posts"}
            </button>
          ))}
        </div>
      )}

      {feed.isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-72 w-full rounded-2xl" />
          ))}
        </div>
      ) : notAllowed ? (
        <EmptyNote title="Community isn't available on this account" body="It's open to active coaching clients." />
      ) : feed.isError ? (
        <div className="rounded-2xl border border-border/80 bg-card p-6 text-center text-sm">
          <p className="text-muted-foreground">Couldn't load the community.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void feed.refetch()}>
            Try again
          </Button>
        </div>
      ) : posts.length === 0 ? (
        scope.kind === "mine" ? (
          <EmptyNote title="Nothing shared yet" body="After a workout, tap Share workout to post it here or keep it just for you." />
        ) : (
          <EmptyNote title="Nothing here yet" body="When someone shares a workout, it shows up here. Finish a session and tap Share workout to be first." />
        )
      ) : (
        <>
          {posts.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              thumbUrl={urls?.[p.media_thumb_path ?? (p.media_type === "image" ? p.media_path ?? "" : "")] ?? null}
              unit={unit}
              viewerIsStaff={viewerIsStaff}
              onOpenComments={setCommentsFor}
              onOpenAuthor={(a) => setScope({ kind: "author", author: a })}
              onDelete={(post) =>
                del.mutate(post, {
                  onSuccess: () => toast.success("Post removed"),
                  onError: (e: any) => toast.error(e?.message ?? "Couldn't remove that post"),
                })
              }
            />
          ))}
          <div ref={sentinel} aria-hidden className="h-px" />
          {isFetchingNextPage && <Skeleton className="h-40 w-full rounded-2xl" />}
          {hasNextPage && !isFetchingNextPage && (
            <Button type="button" variant="ghost" className="w-full" onClick={() => void fetchNextPage()}>
              Show more
            </Button>
          )}
        </>
      )}

      <CommentsSheet post={commentsFor} viewerIsStaff={viewerIsStaff} onClose={() => setCommentsFor(null)} />
    </div>
  );
}

/** One row owns its mutation so an optimistic reaction only re-renders that card. */
function PostRow(props: {
  post: CommunityPost;
  thumbUrl: string | null;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpenComments: (p: CommunityPost) => void;
  onOpenAuthor: (a: CommunityAuthor) => void;
  onDelete: (p: CommunityPost) => void;
}) {
  const react = useReact(props.post, props.viewerIsStaff);
  return (
    <PostCard
      {...props}
      onReact={(_p: CommunityPost, next: ReactionKey | null) => react.mutate(next, { onError: () => toast.error("Couldn't save that reaction") })}
    />
  );
}

function EmptyNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <Dumbbell className="mx-auto h-8 w-8 text-muted-foreground/60" />
      <div className="mt-3 text-sm font-bold">{title}</div>
      <p className="mx-auto mt-1 max-w-[30ch] text-[13px] leading-snug text-muted-foreground">{body}</p>
    </div>
  );
}
