import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { PostCard } from "@/components/community/post-card";
import { CommentsSheet } from "@/components/community/comments-sheet";
import { PostDetailDialog } from "@/components/community/post-detail";
import { ProfileView } from "@/components/community/profile-view";
import { ShareWorkoutButton } from "@/components/community/share-workout-picker";
import { CrewList } from "@/components/community/crew-list";
import { NoteEditor } from "@/components/community/note-editor";
import { markCommunitySeen, useCommunityFeed, useDeletePost, usePostMediaUrls, useReact, useUpdateNote, useViewerUnit } from "@/lib/community.queries";
import type { CommunityAuthor, CommunityPost, ReactionKey } from "@/lib/community";
import { cn } from "@/lib/utils";

type Tab = "feed" | "crew" | "you";
type Scope = { kind: Tab } | { kind: "author"; author: CommunityAuthor; from: Tab };

/** `#post=<id>` opens a post straight away (used by the Home strip and pushes). */
function postFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/post=([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

/** `#person=<user id>` opens someone's profile (used from Home). */
function personFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/person=([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

/**
 * The JF Effect community: workouts people chose to share, newest first, a
 * profile per person, and a full workout page per post. Shared by the client
 * portal and the coach view. No follower counts, no rankings.
 */
export function CommunityScreen({ canShare = false }: { canShare?: boolean }) {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const viewerIsStaff = role === "admin" || role === "coach";
  const [scope, setScope] = useState<Scope>(() => {
    const person = personFromHash();
    return person ? { kind: "author", author: { user_id: person, name: "", avatar_url: null, is_coach: false }, from: "crew" } : { kind: "feed" };
  });
  const tab: Tab = scope.kind === "author" ? scope.from : scope.kind;
  const [commentsFor, setCommentsFor] = useState<CommunityPost | null>(null);
  const [detailId, setDetailId] = useState<string | null>(() => postFromHash());

  const feed = useCommunityFeed(null);
  const posts = useMemo(() => feed.data?.pages.flatMap((p) => p.posts) ?? [], [feed.data]);
  const { data: urls } = usePostMediaUrls(scope.kind === "feed" ? posts : []);
  const del = useDeletePost();
  const updateNote = useUpdateNote();
  const [editing, setEditing] = useState<CommunityPost | null>(null);

  // Opening the community clears the "new posts" badge (server-side, every device).
  const markedRef = useRef(false);
  useEffect(() => {
    if (markedRef.current || !feed.isSuccess) return;
    markedRef.current = true;
    void markCommunitySeen(qc);
  }, [feed.isSuccess, qc]);

  const { data: unit = "lb" } = useViewerUnit(user?.id);

  // Infinite scroll on the feed.
  const sentinel = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || scope.kind !== "feed") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, posts.length, scope.kind]);

  const openAuthor = (a: CommunityAuthor) => {
    setDetailId(null);
    if (a.user_id === user?.id) setScope({ kind: "you" });
    else setScope({ kind: "author", author: a, from: tab });
    window.scrollTo({ top: 0 });
  };
  const closeDetail = () => {
    setDetailId(null);
    if (window.location.hash.includes("post=")) history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  const notAllowed = (feed.error as any)?.code === "42501";

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-3 px-3 pb-12 pt-3 sm:px-4">
      {scope.kind === "author" ? (
        <Button
          type="button"
          variant="ghost"
          className="-ml-2 h-10 rounded-full px-3"
          onClick={() => {
            setScope({ kind: scope.from });
            if (window.location.hash.includes("person=")) history.replaceState(null, "", window.location.pathname + window.location.search);
          }}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> {scope.from === "crew" ? "Crew" : scope.from === "you" ? "You" : "Feed"}
        </Button>
      ) : (
        <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-full bg-muted p-1" role="tablist" aria-label="Community view">
          {(["feed", "crew", "you"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={scope.kind === k}
              onClick={() => setScope({ kind: k })}
              className={cn("h-9 rounded-full px-4 text-[13px] font-bold transition-colors", scope.kind === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
            >
              {k === "feed" ? "Feed" : k === "crew" ? "Crew" : "You"}
            </button>
          ))}
        </div>
        {canShare && <ShareWorkoutButton unit={unit} label="Share" />}
        </div>
      )}

      {scope.kind === "crew" ? (
        <CrewList onOpen={openAuthor} />
      ) : scope.kind === "you" && user?.id ? (
        <ProfileView userId={user.id} unit={unit} onOpenPost={(p) => setDetailId(p.id)} />
      ) : scope.kind === "author" ? (
        <ProfileView userId={scope.author.user_id} unit={unit} onOpenPost={(p) => setDetailId(p.id)} />
      ) : feed.isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-96 w-full rounded-3xl" />
          ))}
        </div>
      ) : notAllowed ? (
        <EmptyNote title="Community isn't available on this account" body="It's open to active coaching clients." />
      ) : feed.isError ? (
        <div className="rounded-3xl border border-border/80 bg-card p-6 text-center text-sm">
          <p className="text-muted-foreground">Couldn't load the community.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void feed.refetch()}>
            Try again
          </Button>
        </div>
      ) : posts.length === 0 ? (
        <EmptyNote
          title="Be the first one in"
          body={canShare ? "Share a session from this month. Your crew sees the work, your coach sees it too." : "When clients share a workout, it shows up here."}
          action={canShare ? <ShareWorkoutButton unit={unit} label="Share your last workout" variant="block" /> : null}
        />
      ) : (
        <>
          {posts.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              thumbUrl={urls?.[p.media_thumb_path ?? (p.media_type === "image" ? p.media_path ?? "" : "")] ?? null}
              unit={unit}
              viewerIsStaff={viewerIsStaff}
              onOpen={(post) => setDetailId(post.id)}
              onOpenComments={setCommentsFor}
              onOpenAuthor={openAuthor}
              onEdit={setEditing}
              onDelete={(post) =>
                del.mutate(post, {
                  onSuccess: () => toast.success("Post removed"),
                  onError: (e: any) => toast.error(e?.message ?? "Couldn't remove that post"),
                })
              }
            />
          ))}
          <div ref={sentinel} aria-hidden className="h-px" />
          {isFetchingNextPage && <Skeleton className="h-64 w-full rounded-3xl" />}
          {!hasNextPage && posts.length > 3 && <p className="py-4 text-center text-[12px] text-muted-foreground">You're all caught up 💪</p>}
        </>
      )}

      <NoteEditor
        open={!!editing}
        title="Edit post"
        initial={editing?.caption ?? ""}
        quote={editing?.quote ? { text: editing.quote, author: editing.quote_author ?? null } : null}
        saving={updateNote.isPending}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          if (editing) await updateNote.mutateAsync({ postId: editing.id, body });
          toast.success("Post updated");
        }}
      />
      <CommentsSheet post={commentsFor} viewerIsStaff={viewerIsStaff} onClose={() => setCommentsFor(null)} />
      <PostDetailDialog postId={detailId} unit={unit} viewerIsStaff={viewerIsStaff} onClose={closeDetail} onOpenAuthor={openAuthor} />
    </div>
  );
}

/** One row owns its mutation so an optimistic reaction only re-renders that card. */
function PostRow(props: {
  post: CommunityPost;
  thumbUrl: string | null;
  unit: "kg" | "lb";
  viewerIsStaff: boolean;
  onOpen: (p: CommunityPost) => void;
  onOpenComments: (p: CommunityPost) => void;
  onOpenAuthor: (a: CommunityAuthor) => void;
  onDelete: (p: CommunityPost) => void;
  onEdit?: (p: CommunityPost) => void;
}) {
  const react = useReact(props.post, props.viewerIsStaff);
  return (
    <PostCard
      {...props}
      onReact={(_p: CommunityPost, next: ReactionKey | null) => react.mutate(next, { onError: () => toast.error("Couldn't save that reaction") })}
    />
  );
}

function EmptyNote({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <Dumbbell className="mx-auto h-8 w-8 text-muted-foreground/60" />
      <div className="mt-3 text-sm font-bold">{title}</div>
      <p className="mx-auto mt-1 max-w-[32ch] text-[13px] leading-snug text-muted-foreground">{body}</p>
      {action ? <div className="mx-auto mt-5 max-w-[300px]">{action}</div> : null}
    </div>
  );
}
