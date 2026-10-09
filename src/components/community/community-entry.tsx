import { useMemo } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Flame, Heart, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { featuredLift, formatTopSet, isTrainingNow, postTimeLabel, reactionEmoji, SCOPE_WORD, type CommunityPost } from "@/lib/community";
import { useCommunityActivity, useCommunityFeed, usePostMediaUrls, useReact, useViewerUnit } from "@/lib/community.queries";
import { PostTileFace, postThumbPath } from "@/components/community/post-tile";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { ShareWorkoutButton } from "@/components/community/share-workout-picker";
import { CrewGoalStrip } from "@/components/community/crew-goal";

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
    <Link to="/admin/community" aria-label={`Community, ${n} new`} className={cn("inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-black text-white shadow-sm", NEW_GRADIENT, className)}>
      <Flame className="h-3.5 w-3.5" /> {n > 9 ? "9+" : n} new
    </Link>
  );
}

/**
 * Home: the community, right under today's training, as a shelf of the
 * week's posts you can see at a glance (the photo, the workout card, the
 * lock-in, the note), Instagram style. Training right now first, then what's
 * new to you (ringed), then the rest; yours last. "+ Share" leads. A tap
 * opens the feed at that post, so you keep scrolling from there. With
 * nothing shared this week it's one inviting line, never an empty widget.
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

  const shelf = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const rank = (t: { live: boolean; fresh: boolean; post: CommunityPost }) => (t.live ? 0 : t.fresh ? 1 : t.post.is_mine ? 3 : 2);
    return (feed.data?.pages[0]?.posts ?? [])
      .filter((p) => new Date(p.created_at).getTime() > weekAgo)
      .map((post) => ({ post, live: isTrainingNow(post), fresh: !post.is_mine && new Date(post.created_at).getTime() > seenAt }))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 8);
  }, [feed.data, seenAt]);
  const { data: urls } = usePostMediaUrls(shelf.map((t) => t.post));
  // "3 locked in today": people who showed up today (local day).
  const lockedToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const ids = new Set<string>();
    for (const p of feed.data?.pages[0]?.posts ?? []) if (p.locked_in_at && new Date(p.locked_in_at) >= start) ids.add(p.author.user_id);
    return ids.size;
  }, [feed.data]);

  if (!activity?.enabled || feed.isLoading) return null;

  return (
    <section className="rounded-2xl border border-border/80 bg-card px-3.5 pb-3 pt-3">
      <div className="flex items-center justify-between gap-2">
        <Link to="/portal/community" hash="feed" className="-my-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap py-1 text-[13px] font-black">
          <Flame className="h-4 w-4 shrink-0 text-orange-500" /> Community
          {/* Who showed up today beats "N new": it's the nudge to go train. */}
          {lockedToday > 0 ? (
            <span className="truncate rounded-full bg-red-500/15 px-1.5 py-px text-[10px] font-bold text-red-600 dark:text-red-400">🔒 {lockedToday} locked in today</span>
          ) : activity.unseen > 0 ? (
            <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold text-white", NEW_GRADIENT)}>{activity.unseen > 9 ? "9+" : activity.unseen} new</span>
          ) : null}
        </Link>
        <button type="button" onClick={() => openAt()} className="-my-1 -mr-1 inline-flex shrink-0 items-center gap-0.5 rounded-full py-1 pl-2 pr-1 text-[12px] font-bold text-muted-foreground active:opacity-70">
          See all <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <CrewGoalStrip className="mt-2" />
      <div className="-mx-1 mt-2.5 flex snap-x items-start gap-2.5 overflow-x-auto px-1 pb-0.5 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ShareWorkoutButton unit={unit} label="Share your session" variant="tile" previewOnly={isImpersonating} />
        {shelf.map(({ post, live, fresh }) => {
          const name = post.is_mine ? "You" : post.author.name;
          const likes = post.reaction_count ?? 0;
          return (
            <button
              key={post.id}
              type="button"
              onClick={() => openAt(post.id)}
              className="w-[112px] shrink-0 snap-start text-left active:scale-[0.97]"
              aria-label={live ? `${name} is training now` : `${name}'s post${fresh ? ", new" : ""}`}
            >
              {/* new to you = the story ring (same as the Community tab's) */}
              <span className={cn("block rounded-[18px] p-[2px]", live ? "bg-red-500" : fresh && "bg-[linear-gradient(135deg,#ffb054,#ef3340)]")}>
              <span
                data-shelf-tile
                data-fresh={fresh ? "" : undefined}
                className={cn("relative block h-[136px] w-full overflow-hidden rounded-2xl bg-muted", (live || fresh) && "border-2 border-card")}
              >
                <PostTileFace post={post} thumb={urls?.[postThumbPath(post) ?? ""] ?? null} unit={unit} footer={likes > 0 || post.comment_count > 0} />
                {live && <span className="absolute left-1.5 top-1.5 rounded-[5px] bg-red-500 px-1 text-[8px] font-black uppercase leading-[13px] tracking-wide text-white">Live</span>}
                {(likes > 0 || post.comment_count > 0) && (
                  <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                    {likes > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <Heart className="h-3 w-3 fill-white" /> {likes}
                      </span>
                    )}
                    {post.comment_count > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <MessageCircle className="h-3 w-3" /> {post.comment_count}
                      </span>
                    )}
                  </span>
                )}
              </span>
              </span>
              <span className="mt-1.5 flex min-w-0 items-center gap-1 text-[11px] leading-tight">
                <UserAvatar src={post.author.avatar_url} name={post.author.name} size={18} expandable={false} />
                <span className="min-w-0 truncate font-bold">{name}</span>
                <span className="shrink-0 text-muted-foreground">{postTimeLabel(post.created_at)}</span>
              </span>
            </button>
          );
        })}
        {shelf.length === 0 && (
          <div className="flex min-h-[140px] flex-1 flex-col justify-center pr-1">
            <div className="text-[13px] font-bold leading-tight">Be the first to share this week</div>
            <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">Post a session for the crew. Your coach sees every one.</div>
          </div>
        )}
      </div>
    </section>
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
