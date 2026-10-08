import { useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Flame, Heart, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { featuredLift, formatTopSet, isTrainingNow, postTimeLabel, reactionEmoji, SCOPE_WORD, type CommunityPost } from "@/lib/community";
import { useCommunityActivity, useCommunityFeed, useReact, useViewerUnit } from "@/lib/community.queries";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { ShareWorkoutButton } from "@/components/community/share-workout-picker";
import { PostDetailDialog } from "@/components/community/post-detail";

const NEW_GRADIENT = "bg-primary";

/** One line that says what a post is: a coach note's first line, or the session and its best lift. */
function postLine(post: CommunityPost, unit: "kg" | "lb"): string {
  if (post.kind === "note") return (post.caption ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "Posted";
  const lift = post.stats ? featuredLift(post.stats) : null;
  return (
    (!post.stats && post.locked_in_at ? `🔒 Locked in · ${post.session_title ?? "Workout"}` : post.stats?.workout_title ?? post.session_title ?? "Workout") +
    (lift ? ` · ${lift.name} ${formatTopSet(lift.detail, unit)}` : "") +
    (lift?.pr ? ` · ${SCOPE_WORD[lift.pr]}` : "")
  );
}

/**
 * Header nudge, only when there is something new ("🔥 3 new"). With nothing
 * new it renders nothing: the community is on Home (clients) and on the
 * dashboard (coaches), never as a mystery icon.
 */
export function CommunityNavButton({ className }: { className?: string }) {
  const { role } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const inPortal = path.startsWith("/portal");
  const inAdmin = path.startsWith("/admin");
  const staff = role === "admin" || role === "coach";
  const eligible = inPortal || (inAdmin && staff);
  const { data } = useCommunityActivity(eligible);
  // Pages that already surface the community themselves.
  const hidden = path === "/admin" || path === "/admin/" || path.endsWith("/community");
  if (!eligible || hidden || !data?.enabled || data.unseen <= 0) return null;
  const n = data.unseen;
  return inAdmin ? (
    <Link to="/admin/community" aria-label={`Community, ${n} new`} className={cn("inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-black text-white shadow-sm", NEW_GRADIENT, className)}>
      <Flame className="h-3.5 w-3.5" /> {n > 9 ? "9+" : n} new
    </Link>
  ) : (
    <Link to="/portal/community" aria-label={`Community, ${n} new`} className={cn("inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-black text-white shadow-sm", NEW_GRADIENT, className)}>
      <Flame className="h-3.5 w-3.5" /> {n > 9 ? "9+" : n} new
    </Link>
  );
}

/**
 * Home: the community, right under today's training, so it's seen without
 * costing a tab. "+ Share" first, Instagram-stories style, then who shared
 * this week (ring = new to you), and one line with the newest post (from the
 * last 3 days, someone else's, unseen first). Tapping a person or the post
 * opens it right here over Home; the title or "See all" / "N new" opens the
 * feed. With nothing shared yet it's a single inviting line, never an empty
 * widget.
 */
export function CommunityHomeStrip() {
  const { user } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const { data: unit = "lb" } = useViewerUnit(user?.id);
  const { data: activity } = useCommunityActivity(true);
  const feed = useCommunityFeed(null);
  const seenAt = activity?.seen_at ? new Date(activity.seen_at).getTime() : 0;
  const [openPost, setOpenPost] = useState<string | null>(null);
  const navigate = useNavigate();

  const people = useMemo(() => {
    const posts = feed.data?.pages[0]?.posts ?? [];
    const weekAgo = Date.now() - 7 * 86_400_000;
    const seen = new Set<string>();
    const out: { id: string; userId: string; name: string; avatar: string | null; fresh: boolean; mine: boolean; live: boolean }[] = [];
    for (const p of posts) {
      const at = new Date(p.created_at).getTime();
      if (at < weekAgo || seen.has(p.author.user_id)) continue;
      seen.add(p.author.user_id);
      out.push({ id: p.id, userId: p.author.user_id, name: p.author.name, avatar: p.author.avatar_url, fresh: !p.is_mine && at > seenAt, mine: p.author.user_id === user?.id, live: isTrainingNow(p) });
    }
    // Training right now goes first: that's the "hop in" moment.
    return out.sort((a, b) => Number(b.live) - Number(a.live));
  }, [feed.data, seenAt, user?.id]);
  // "3 locked in today": people who showed up today (local day).
  const lockedToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const ids = new Set<string>();
    for (const p of feed.data?.pages[0]?.posts ?? []) if (p.locked_in_at && new Date(p.locked_in_at) >= start) ids.add(p.author.user_id);
    return ids.size;
  }, [feed.data]);
  // The newest post worth a glance: someone else's, last 3 days, unseen first.
  const latest = useMemo(() => {
    const cutoff = Date.now() - 3 * 86_400_000;
    const others = (feed.data?.pages[0]?.posts ?? []).filter((p) => !p.is_mine && new Date(p.created_at).getTime() > cutoff);
    const fresh = others.find((p) => new Date(p.created_at).getTime() > seenAt);
    const post = fresh ?? others[0] ?? null;
    return post ? { post, fresh: !!fresh } : null;
  }, [feed.data, seenAt]);

  if (!activity?.enabled || feed.isLoading) return null;

  return (
    <section className="rounded-2xl border border-border/80 bg-card px-3.5 pb-3 pt-3">
      <div className="flex items-center justify-between">
        <Link to="/portal/community" className="-my-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap py-1 text-[13px] font-black">
          <Flame className="h-4 w-4 shrink-0 text-orange-500" /> Community
          {/* Who showed up today beats "N new": it's the nudge to go train. */}
          {lockedToday > 0 ? (
            <span className="truncate rounded-full bg-red-500/15 px-1.5 py-px text-[10px] font-bold text-red-600 dark:text-red-400">🔒 {lockedToday} locked in today</span>
          ) : activity.unseen > 0 ? (
            <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold text-white", NEW_GRADIENT)}>{activity.unseen} new</span>
          ) : null}
        </Link>
        <Link to="/portal/community" className="-my-1 flex shrink-0 items-center whitespace-nowrap py-1 pl-3 text-[12px] font-bold text-muted-foreground">
          {activity.unseen > 0 && lockedToday > 0 ? (
            <span className="text-primary">{activity.unseen > 9 ? "9+" : activity.unseen} new</span>
          ) : people.length ? (
            "See all"
          ) : (
            "Open"
          )}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="-mx-1 mt-2.5 flex items-start gap-3 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ShareWorkoutButton unit={unit} label="Share" variant="bubble" previewOnly={isImpersonating} />
        {people.map((p) => (
          <button key={p.userId} type="button" onClick={() => setOpenPost(p.id)} className="flex w-[64px] shrink-0 flex-col items-center gap-1 active:scale-95" aria-label={p.live ? `${p.name} is training now` : `${p.name}'s latest workout`}>
            <span className={cn("relative rounded-full p-[2.5px]", p.live ? "bg-red-500" : p.fresh ? "bg-[linear-gradient(135deg,#ffb054,#ef3340)]" : "bg-border")}>
              <span className="block rounded-full bg-card p-[2px]">
                <UserAvatar src={p.avatar} name={p.name} size={52} expandable={false} />
              </span>
              {p.live && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-[5px] border-2 border-card bg-red-500 px-1 text-[8px] font-black uppercase leading-[12px] tracking-wide text-white">Live</span>}
            </span>
            <span className="w-full truncate text-center text-[11px] font-semibold">{p.mine ? "You" : p.name}</span>
          </button>
        ))}
        {people.length === 0 && (
          <div className="flex min-h-[61px] flex-1 flex-col justify-center pr-1">
            <div className="text-[13px] font-bold leading-tight">Be the first to share this week</div>
            <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">Post a session for the crew. Your coach sees every one.</div>
          </div>
        )}
      </div>
      {latest && (
        <button
          type="button"
          onClick={() => setOpenPost(latest.post.id)}
          className="mt-2.5 flex w-full items-center gap-2.5 border-t border-border/70 pt-2.5 text-left active:opacity-70"
          aria-label={`${latest.post.author.name}'s post`}
        >
          <UserAvatar src={latest.post.author.avatar_url} name={latest.post.author.name} size={32} expandable={false} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-[12px] leading-tight">
              {latest.fresh && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="New" />}
              <span className="truncate font-bold">{latest.post.author.name}</span>
              <span className="shrink-0 text-muted-foreground">· {postTimeLabel(latest.post.created_at)}</span>
            </div>
            <div className="mt-0.5 truncate text-[13px] leading-snug text-foreground/85">{postLine(latest.post, unit)}</div>
          </div>
          {((latest.post.reaction_count ?? 0) > 0 || latest.post.comment_count > 0) && (
            <span className="flex shrink-0 items-center gap-2 text-[11px] font-bold text-muted-foreground">
              {(latest.post.reaction_count ?? 0) > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <Heart className="h-3.5 w-3.5" /> {latest.post.reaction_count}
                </span>
              )}
              {latest.post.comment_count > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <MessageCircle className="h-3.5 w-3.5" /> {latest.post.comment_count}
                </span>
              )}
            </span>
          )}
        </button>
      )}
      <PostDetailDialog
        postId={openPost}
        unit={unit}
        viewerIsStaff={false}
        onClose={() => setOpenPost(null)}
        onOpenAuthor={(a) => {
          setOpenPost(null);
          navigate({ to: "/portal/community", hash: a.user_id === user?.id ? undefined : `person=${a.user_id}` });
        }}
      />
    </section>
  );
}

/**
 * Coach dashboard: what clients shared this week, with a one-tap 🔥 per post.
 * Coach props are the strongest thing this community has ("my coach saw my
 * training"), so they're one tap from where the coach already starts the day.
 * Hidden when nobody has shared this week.
 */
export function CommunityCoachCard() {
  const { user } = useAuth();
  const { data: unit = "lb" } = useViewerUnit(user?.id);
  const { data: activity } = useCommunityActivity(true);
  const feed = useCommunityFeed(null);
  const posts = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    return (feed.data?.pages[0]?.posts ?? []).filter((p) => !p.is_mine && p.kind !== "note" && new Date(p.created_at).getTime() > weekAgo).slice(0, 4);
  }, [feed.data]);

  if (!activity?.enabled) return null;

  // Always visible for coaches: it's their tool, and with nothing shared yet
  // a hidden card meant the coach couldn't see the community existed at all.
  if (posts.length === 0) {
    const anyEver = (feed.data?.pages[0]?.posts?.length ?? 0) > 0;
    return (
      <Link to="/admin/community" className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition hover:border-primary/40">
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-white", NEW_GRADIENT)}>
          <Flame className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold">Community</div>
          <div className="truncate text-[12px] text-muted-foreground">
            {anyEver ? "Nothing shared this week yet. Open the feed" : "No posts yet. Clients share from Home and after each workout"}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    );
  }
  const waiting = posts.filter((p) => !p.my_reaction).length;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-bold tracking-tight">
          <Flame className="h-4 w-4 text-orange-500" /> Community
          {activity.unseen > 0 && <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold text-white", NEW_GRADIENT)}>{activity.unseen} new</span>}
        </h2>
        <Link to="/admin/community" className="flex items-center text-[12px] font-bold text-muted-foreground">
          Open <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <p className="mb-2 text-[12px] text-muted-foreground">
        {waiting > 0 ? `${waiting} ${waiting === 1 ? "workout is" : "workouts are"} waiting on your props. One tap tells them you saw it.` : "You've given props on everything shared this week."}
      </p>
      <div className="divide-y divide-border/70">
        {posts.map((p) => (
          <CoachPostRow key={p.id} post={p} unit={unit} />
        ))}
      </div>
    </section>
  );
}

function CoachPostRow({ post, unit }: { post: CommunityPost; unit: "kg" | "lb" }) {
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
