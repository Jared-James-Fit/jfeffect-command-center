import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge } from "@/components/community/post-card";
import { postTimeLabel, type CommunityAuthor } from "@/lib/community";
import { useCommunityMembers } from "@/lib/community.queries";

/**
 * Everyone in the JF crew: coaches first, then whoever shared most recently.
 * Tap anyone to open their profile. No follow buttons, no counts to compete on.
 */
export function CrewList({ onOpen }: { onOpen: (a: CommunityAuthor) => void }) {
  const { data: members, isLoading, isError, refetch } = useCommunityMembers(true);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <button type="button" onClick={() => void refetch()} className="w-full rounded-2xl border border-border/80 bg-card p-5 text-center text-sm text-muted-foreground">
        Couldn't load the crew. Tap to try again.
      </button>
    );
  }
  if (!members?.length) {
    return <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-[13px] text-muted-foreground">Nobody else here yet.</div>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="border-b border-border/60 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {members.length + 1} in the JF crew
      </div>
      <div className="divide-y divide-border/60">
        {members.map((m) => (
          <button key={m.author.user_id} type="button" onClick={() => onOpen(m.author)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-muted">
            <span className={cn("shrink-0 rounded-full", m.live && "ring-2 ring-red-500 ring-offset-2 ring-offset-card")}>
              <UserAvatar src={m.author.avatar_url} name={m.author.name} size={44} expandable={false} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[15px] font-bold">{m.author.name}</span>
                {m.author.is_coach && <CoachBadge />}
                {m.live && <span className="rounded-[5px] bg-red-500 px-1 text-[9px] font-black uppercase leading-[14px] text-white">Live</span>}
              </span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {m.bio ||
                  (m.posts > 0
                    ? `${m.author.is_coach ? m.author.title || "Coach · JF Effect" : `${m.posts} ${m.posts === 1 ? "post" : "posts"}`} · ${postTimeLabel(m.last_post_at!)}`
                    : m.author.is_coach
                      ? m.author.title || "Coach · JF Effect"
                      : "No posts yet")}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
