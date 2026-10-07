import { useMemo } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Flame } from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { featuredLift, formatTopSet, postTimeLabel, SCOPE_WORD, type CommunityPost } from "@/lib/community";
import { useCommunityActivity, useCommunityFeed, useReact, useViewerUnit } from "@/lib/community.queries";

/** Where the community lives for clients: a tab inside Workouts. */
export const CLIENT_COMMUNITY_HASH = "community";
export const clientCommunityHash = (postId?: string) => (postId ? `${CLIENT_COMMUNITY_HASH}&post=${postId}` : CLIENT_COMMUNITY_HASH);

const NEW_GRADIENT = "bg-[linear-gradient(135deg,#f58529,#dd2a7b)]";

/**
 * Header nudge, only when there is something new ("🔥 3 new"). With nothing
 * new it renders nothing: the community lives in Workouts (clients) and on
 * the dashboard (coaches), never as a mystery icon.
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
  const hidden = path === "/portal/workouts" || path === "/portal/workouts/" || path === "/admin" || path === "/admin/" || path.endsWith("/community");
  if (!eligible || hidden || !data?.enabled || data.unseen <= 0) return null;
  const n = data.unseen;
  return inAdmin ? (
    <Link to="/admin/community" aria-label={`Community, ${n} new`} className={cn("inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-black text-white shadow-sm", NEW_GRADIENT, className)}>
      <Flame className="h-3.5 w-3.5" /> {n > 9 ? "9+" : n} new
    </Link>
  ) : (
    <Link to="/portal/workouts" hash={CLIENT_COMMUNITY_HASH} aria-label={`Community, ${n} new`} className={cn("inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-black text-white shadow-sm", NEW_GRADIENT, className)}>
      <Flame className="h-3.5 w-3.5" /> {n > 9 ? "9+" : n} new
    </Link>
  );
}

/** "My training | Community" at the top of the Workouts tab. */
export function WorkoutsViewSwitch({ view, onChange }: { view: "training" | "community"; onChange: (v: "training" | "community") => void }) {
  const { data } = useCommunityActivity(true);
  if (!data?.enabled) return null;
  const n = data.unseen;
  return (
    <div className="grid grid-cols-2 rounded-2xl bg-muted p-1" role="tablist" aria-label="Workouts view">
      {(["training", "community"] as const).map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={view === k}
          onClick={() => onChange(k)}
          className={cn(
            "relative flex h-10 items-center justify-center gap-1.5 rounded-xl text-[14px] font-bold transition-colors",
            view === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          {k === "training" ? "My training" : (
            <>
              <Flame className={cn("h-4 w-4", view === k ? "text-orange-500" : "")} /> Community
              {n > 0 && view !== k && <span className={cn("rounded-full px-1.5 text-[10px] font-black text-white", NEW_GRADIENT)}>{n > 9 ? "9+" : n}</span>}
            </>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Home: who shared recently, Instagram-stories style. Renders nothing when
 * nobody has shared in the last week, so it never becomes an empty social
 * widget on the training dashboard.
 */
export function CommunityHomeStrip() {
  const { user } = useAuth();
  const { data: activity } = useCommunityActivity(true);
  const feed = useCommunityFeed(null);
  const seenAt = activity?.seen_at ? new Date(activity.seen_at).getTime() : 0;

  const people = useMemo(() => {
    const posts = feed.data?.pages[0]?.posts ?? [];
    const weekAgo = Date.now() - 7 * 86_400_000;
    const seen = new Set<string>();
    const out: { id: string; userId: string; name: string; avatar: string | null; fresh: boolean; mine: boolean }[] = [];
    for (const p of posts) {
      const at = new Date(p.created_at).getTime();
      if (at < weekAgo || seen.has(p.author.user_id)) continue;
      seen.add(p.author.user_id);
      out.push({ id: p.id, userId: p.author.user_id, name: p.author.name, avatar: p.author.avatar_url, fresh: !p.is_mine && at > seenAt, mine: p.author.user_id === user?.id });
    }
    return out;
  }, [feed.data, seenAt, user?.id]);

  if (!activity?.enabled || people.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border/80 bg-card px-3.5 pb-3 pt-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] font-black">
          <Flame className="h-4 w-4 text-orange-500" /> Community
          {activity.unseen > 0 && <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold text-white", NEW_GRADIENT)}>{activity.unseen} new</span>}
        </div>
        <Link to="/portal/workouts" hash={CLIENT_COMMUNITY_HASH} className="flex items-center text-[12px] font-bold text-muted-foreground">
          See all <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="-mx-1 mt-2.5 flex gap-3 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {people.map((p) => (
          <Link key={p.userId} to="/portal/workouts" hash={clientCommunityHash(p.id)} className="flex w-[64px] shrink-0 flex-col items-center gap-1" aria-label={`${p.name}'s latest workout`}>
            <span className={cn("rounded-full p-[2.5px]", p.fresh ? "bg-[linear-gradient(135deg,#f58529,#dd2a7b,#8134af)]" : "bg-border")}>
              <span className="block rounded-full bg-card p-[2px]">
                <UserAvatar src={p.avatar} name={p.name} size={52} expandable={false} />
              </span>
            </span>
            <span className="w-full truncate text-center text-[11px] font-semibold">{p.mine ? "You" : p.name}</span>
          </Link>
        ))}
      </div>
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
    return (feed.data?.pages[0]?.posts ?? []).filter((p) => !p.is_mine && new Date(p.created_at).getTime() > weekAgo).slice(0, 4);
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
            {anyEver ? "Nothing shared this week yet. Open the feed" : "No posts yet. Clients share from Workouts → Community"}
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
  const lift = post.stats ? featuredLift(post.stats) : null;
  const given = post.my_reaction === "fire";
  return (
    <div className="flex items-center gap-3 py-2.5">
      <UserAvatar src={post.author.avatar_url} name={post.author.name} size={38} expandable={false} />
      <Link to="/admin/community" hash={`post=${post.id}`} className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold">
          {post.author.name} <span className="font-normal text-muted-foreground">· {postTimeLabel(post.created_at)}</span>
        </div>
        <div className="truncate text-[12px] text-muted-foreground">
          {post.stats?.workout_title ?? "Workout"}
          {lift ? ` · ${lift.name} ${formatTopSet(lift.detail, unit)}` : ""}
          {lift?.pr ? ` · ${SCOPE_WORD[lift.pr]}` : ""}
        </div>
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
        🔥 {given ? "Sent" : "Props"}
      </button>
    </div>
  );
}
