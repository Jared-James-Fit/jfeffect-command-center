import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, Flame, Heart, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { featuredLift, formatTopSet, homeCrewPosts, isTrainingNow, postTimeLabel, reactionEmoji, SCOPE_WORD, type CommunityPost } from "@/lib/community";
import { useCommunityActivity, useCommunityFeed, usePostMediaUrls, useReact, useViewerUnit } from "@/lib/community.queries";
import { PostTileFace, postThumbPath } from "@/components/community/post-tile";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { ShareWorkoutButton } from "@/components/community/share-workout-picker";
import { CrewGoalStrip } from "@/components/community/crew-goal";
import { EngagementPop } from "@/components/community/engagement-pop";
import { usePostViewTracker } from "@/components/community/post-views";
import { ShareNudge } from "@/components/community/share-nudge";

const NEW_GRADIENT = "bg-primary";

/** One line that says what a post is: a coach note's first line, or the session and its best lift. */
function postLine(post: CommunityPost, unit: "kg" | "lb"): string {
  if (post.kind === "note") {
    const line = (post.caption ?? "").split("\n").map((l) => l.trim()).find(Boolean);
    const shared = post.shared_comment && !post.shared_comment.gone ? post.shared_comment : null;
    if (shared) return line ? `${line} · "${shared.body || "📷"}"` : `Shared ${shared.author.name}'s comment: "${shared.body || "📷"}"`;
    return line ?? "Posted";
  }
  const lift = post.stats ? featuredLift(post.stats) : null;
  return (
    (!post.stats && post.locked_in_at ? `🔒 Locked in · ${post.session_title ?? "Workout"}` : post.stats?.workout_title ?? post.session_title ?? "Workout") +
    (lift ? ` · ${lift.name} ${formatTopSet(lift.detail, unit)}` : "") +
    (lift?.pr ? ` · ${SCOPE_WORD[lift.pr]}` : "")
  );
}

/**
 * Coaches' header nudge, only when there is something new ("🔥 3 new"). With
 * nothing new it renders nothing. Clients don't need it: Community is the
 * centre tab, with its own count.
 */
export function CommunityNavButton({ className }: { className?: string }) {
  const { role } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const staff = role === "admin" || role === "coach";
  const eligible = path.startsWith("/admin") && staff;
  const { data } = useCommunityActivity(eligible);
  // Pages that already surface the community themselves.
  const hidden = path === "/admin" || path === "/admin/" || path.endsWith("/community");
  if (!eligible || hidden || !data?.enabled || data.unseen <= 0) return null;
  const n = data.unseen;
  return (
    // Phones have the League button in the bar with the same count.
    <Link to="/admin/community" aria-label={`Community, ${n} new`} className={cn("hidden h-9 shrink-0 md:inline-flex items-center gap-1 rounded-full px-3 text-[12px] font-black text-white shadow-sm", NEW_GRADIENT, className)}>
      <Flame className="h-3.5 w-3.5" /> {n > 9 ? "9+" : n} new
    </Link>
  );
}

/**
 * Home's Crew feed, right under today's training: the newest posts as cards
 * you swipe through (a photo shows its first slide only, so a carousel never
 * fights the swipe), then a card that opens the feed to keep going. "+ Post"
 * is always one tap away; now and then (until their first post) a card asks
 * them to lock in or share. Tapping a post opens the feed at it.
 */
export function CommunityHomeStrip() {
  const { user } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const { data: unit = "lb" } = useViewerUnit(user?.id);
  const { data: activity } = useCommunityActivity(true);
  const feed = useCommunityFeed(null);
  const seenAt = activity?.seen_at ? new Date(activity.seen_at).getTime() : 0;
  const navigate = useNavigate();
  const openAt = (postId?: string) => navigate({ to: "/portal/community", hash: postId ? `at=${postId}` : "feed" });

  const { shown, more } = useMemo(() => homeCrewPosts(feed.data?.pages[0]?.posts ?? []), [feed.data]);
  const { data: urls } = usePostMediaUrls(shown);
  // "3 locked in today": people who showed up today (local day).
  const lockedToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const ids = new Set<string>();
    for (const p of feed.data?.pages[0]?.posts ?? []) if (p.locked_in_at && new Date(p.locked_in_at) >= start) ids.add(p.author.user_id);
    return ids.size;
  }, [feed.data]);

  if (!activity?.enabled || feed.isLoading) return null;
  const cards = shown.map((post) => <CrewCard key={post.id} post={post} unit={unit} thumb={urls?.[postThumbPath(post) ?? ""] ?? null} fresh={!post.is_mine && new Date(post.created_at).getTime() > seenAt} onOpen={() => openAt(post.id)} />);
  // the invite sits second, after the newest post (first when there's none)
  const nudge = <ShareNudge key="nudge" surface="home" unit={unit} />;
  cards.splice(Math.min(1, cards.length), 0, nudge);

  return (
    <section data-crew-feed className="rounded-2xl border border-border/80 bg-card pb-3 pt-3">
      <div className="flex items-center justify-between gap-2 px-3.5">
        <Link to="/portal/community" hash="feed" className="-my-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap py-1">
          <span className="text-[16px] font-black tracking-tight">Crew feed</span>
          {/* Who showed up today beats "N new": it's the nudge to go train. */}
          {lockedToday > 0 ? (
            <span className="truncate rounded-full bg-red-500/15 px-1.5 py-px text-[10px] font-bold text-red-600 dark:text-red-400">🔒 {lockedToday} locked in today</span>
          ) : activity.unseen > 0 ? (
            <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold text-white", NEW_GRADIENT)}>{activity.unseen > 9 ? "9+" : activity.unseen} new</span>
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </Link>
        <ShareWorkoutButton unit={unit} label="Post" previewOnly={isImpersonating} className="h-8 px-3 text-[12px]" />
      </div>
      <div className="mt-2.5 flex h-[200px] snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain px-[9%] [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {shown.length === 0 && (
          <div className="flex h-full w-[82%] shrink-0 snap-center snap-always flex-col justify-center rounded-[20px] border border-dashed border-border bg-muted/30 p-4">
            <div className="text-[15px] font-black leading-tight">Be the first to share this week</div>
            <div className="mt-1 text-[12.5px] leading-snug text-muted-foreground">Post a session for the crew. Your coach sees every one.</div>
          </div>
        )}
        {cards}
        <SeeMoreCard posts={feed.data?.pages[0]?.posts ?? []} shown={shown} more={more} onOpen={() => openAt()} />
      </div>
      <CrewGoalStrip className="mt-3 px-3.5" />
    </section>
  );
}

/** One post on Home, big enough to read: who and when along the top, the post, its likes and comments. */
function CrewCard({ post, unit, thumb: signed, fresh, onOpen }: { post: CommunityPost; unit: "kg" | "lb"; thumb: string | null; fresh: boolean; onOpen: () => void }) {
  // a picture that failed to load is shown (and dressed) as the card instead
  const [broken, setBroken] = useState<string | null>(null);
  const thumb = signed && signed !== broken ? signed : null;
  // on screen (half of it) for two seconds = a view, here too
  const ref = useRef<HTMLButtonElement | null>(null);
  usePostViewTracker(ref, post);
  const live = isTrainingNow(post);
  const name = post.is_mine ? "You" : post.author.name.split(" ")[0];
  const likes = post.reaction_count ?? 0;
  const counts = likes > 0 || post.comment_count > 0;
  const photo = !!(post.media_type && thumb);
  const lift = photo && post.stats ? featuredLift(post.stats) : null;
  // a photo says what the session was underneath it
  const title = photo ? (post.stats?.workout_title ?? (post.locked_in_at ? "Locked in" : null)) : null;
  const detail = photo ? (lift ? `${formatTopSet(lift.detail, unit)}${lift.pr ? " · PR" : ""}` : post.locked_in_at && !post.stats ? post.session_title : post.caption?.split("\n")[0]) : null;
  return (
    <button
      ref={ref}
      type="button"
      data-crew-card
      data-fresh={fresh ? "" : undefined}
      onClick={onOpen}
      className="relative h-full w-[82%] shrink-0 snap-center snap-always overflow-hidden rounded-[20px] bg-muted text-left transition-transform active:scale-[0.98]"
      aria-label={live ? `${name} is training now` : `${name}'s post${fresh ? ", new" : ""}`}
    >
      <PostTileFace post={post} thumb={thumb} unit={unit} footer={counts} large onBroken={setBroken} />
      {/* who and when: over a soft shade on a photo; a note card is light or dark with the theme */}
      <span className={cn("absolute inset-x-0 top-0 flex items-center gap-1.5 px-3 pb-5 pt-2.5", photo ? "bg-gradient-to-b from-black/55 to-transparent text-white" : post.kind === "note" ? "text-foreground" : "text-white")}>
        <UserAvatar src={post.author.avatar_url} name={post.author.name} size={24} expandable={false} />
        <span className={cn("min-w-0 truncate text-[12px] font-bold", photo && "drop-shadow")}>{name}</span>
        <span className={cn("shrink-0 text-[11px]", post.kind === "note" && !photo ? "text-muted-foreground" : "text-white/75")}>{postTimeLabel(post.created_at)}</span>
        {live ? (
          <span className="shrink-0 rounded-[5px] bg-red-500 px-1 text-[9px] font-black uppercase leading-[14px] tracking-wide">Live</span>
        ) : fresh ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff5a4e]" aria-hidden />
        ) : null}
      </span>
      {(title || detail) && (
        <span className={cn("absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pt-8 text-white", counts ? "pb-10" : "pb-3")}>
          {title && <span className="font-display block truncate text-[20px] uppercase leading-none">{title}</span>}
          {detail && <span className={cn("mt-1 block truncate text-[12px] font-semibold", lift?.pr ? "text-amber-300" : "text-white/85")}>{detail}</span>}
        </span>
      )}
      {counts && (
        <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-2 rounded-full bg-black/55 px-2 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
          {likes > 0 && (
            <span className="inline-flex items-center gap-1">
              <Heart className="h-3.5 w-3.5 fill-white" /> {likes}
            </span>
          )}
          {post.comment_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" /> {post.comment_count}
            </span>
          )}
        </span>
      )}
      <EngagementPop post={post} />
    </button>
  );
}

/** The end of Home's swipe: the rest is in the feed (faces of who else posted). */
function SeeMoreCard({ posts, shown, more, onOpen }: { posts: CommunityPost[]; shown: CommunityPost[]; more: number; onOpen: () => void }) {
  const faces = useMemo(() => {
    const seen = new Set<string>();
    const out: CommunityPost["author"][] = [];
    for (const p of [...posts.filter((p) => !shown.includes(p)), ...shown]) {
      if (seen.has(p.author.user_id)) continue;
      seen.add(p.author.user_id);
      out.push(p.author);
      if (out.length === 3) break;
    }
    return out;
  }, [posts, shown]);
  return (
    <button type="button" data-crew-more onClick={onOpen} className="flex h-full w-[42%] shrink-0 snap-center snap-always flex-col items-center justify-center gap-2.5 rounded-[20px] border border-border/80 bg-muted/40 px-3 text-center active:scale-[0.98]">
      {faces.length > 0 && (
        <span className="flex -space-x-2">
          {faces.map((a) => (
            <span key={a.user_id} className="rounded-full ring-2 ring-card">
              <UserAvatar src={a.avatar_url} name={a.name} size={30} expandable={false} />
            </span>
          ))}
        </span>
      )}
      <span className="text-[14px] font-black leading-tight">{more > 0 ? `${more} more in the feed` : "Open the feed"}</span>
      <span className="text-[11.5px] leading-snug text-muted-foreground">React, comment, see every set</span>
      <span className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-background">
        <ArrowRight className="h-4 w-4" />
      </span>
    </button>
  );
}

/** One shared workout with a one-tap 🔥 (the Community page's "waiting on your props"). */
export function CoachPostRow({ post, unit }: { post: CommunityPost; unit: "kg" | "lb" }) {
  const react = useReact(post, true);
  // any reaction counts as props given (a ❤️ from the feed too); props itself is 🔥
  const given = !!post.my_reaction;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <UserAvatar src={post.author.avatar_url} name={post.author.name} size={38} expandable={false} />
      <Link to="/admin/community" hash={`post=${post.id}`} className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold">
          {post.author.name} <span className="font-normal text-muted-foreground">· {postTimeLabel(post.created_at)}</span>
        </div>
        <div className="truncate text-[12px] text-muted-foreground">{postLine(post, unit)}</div>
      </Link>
      <button
        type="button"
        onClick={() => react.mutate(given ? null : "fire", { onSuccess: () => !given && toast.success(`Props sent to ${post.author.name} 🔥`), onError: () => toast.error("Couldn't send that") })}
        aria-pressed={given}
        aria-label={given ? "Remove props" : `Give ${post.author.name} props`}
        className={cn(
          "flex h-10 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-black transition active:scale-90",
          given ? "bg-orange-500/15 text-orange-600 dark:text-orange-400" : "border border-border text-foreground",
        )}
      >
        {given ? `${reactionEmoji(post.my_reaction) ?? "🔥"} Sent` : "🔥 Props"}
      </button>
    </div>
  );
}
