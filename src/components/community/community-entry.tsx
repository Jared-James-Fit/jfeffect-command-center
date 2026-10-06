import { useMemo } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Users } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useCommunityActivity, useCommunityFeed } from "@/lib/community.queries";

/**
 * Header shortcut to the community with a quiet "new posts" count. Hidden for
 * accounts that can't use the community (memberships, archived clients).
 */
export function CommunityNavButton({ className }: { className?: string }) {
  const { role } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const inPortal = path.startsWith("/portal");
  const inAdmin = path.startsWith("/admin");
  const staff = role === "admin" || role === "coach";
  const { data } = useCommunityActivity(inPortal || (inAdmin && staff));
  if (!data?.enabled || (!inPortal && !(inAdmin && staff))) return null;
  const to = inAdmin ? "/admin/community" : "/portal/community";
  if (path === to) return null;
  const n = data.unseen;
  return (
    <Link
      to={to}
      aria-label={n > 0 ? `Community, ${n} new` : "Community"}
      className={cn("relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card transition hover:border-primary/40", className)}
    >
      <Users className="h-[18px] w-[18px]" />
      {n > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-[linear-gradient(135deg,#f58529,#dd2a7b)] px-1 text-[10px] font-bold text-white">
          {n > 9 ? "9+" : n}
        </span>
      )}
    </Link>
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
        <div className="text-[13px] font-black">
          Community
          {activity.unseen > 0 && <span className="ml-1.5 rounded-full bg-[linear-gradient(135deg,#f58529,#dd2a7b)] px-1.5 py-px text-[10px] font-bold text-white">{activity.unseen} new</span>}
        </div>
        <Link to="/portal/community" className="flex items-center text-[12px] font-bold text-muted-foreground">
          See all <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="-mx-1 mt-2.5 flex gap-3 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {people.map((p) => (
          <Link key={p.userId} to="/portal/community" hash={`post=${p.id}`} className="flex w-[64px] shrink-0 flex-col items-center gap-1" aria-label={`${p.name}'s latest workout`}>
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
