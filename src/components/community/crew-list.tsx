import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge } from "@/components/community/post-card";
import { communityIsoDow, trainedLabel, trainingSinceLabel, type CommunityAuthor, type CommunityMember } from "@/lib/community";
import { useCommunityMembers, useCommunityProfile, useCrewGoal } from "@/lib/community.queries";
import { useAuth } from "@/lib/auth";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** This week, Mon to Sun: a filled dot for each day they trained, today ringed. */
function WeekDots({ days, today }: { days: number[]; today: number }) {
  const set = new Set(days);
  return (
    <span className="flex shrink-0 items-center gap-[3px]" aria-label={`Trained ${days.map((d) => DAYS[d - 1]).join(", ")} this week`} role="img">
      {DAYS.map((_, i) => {
        const d = i + 1;
        return (
          <span
            key={d}
            className={cn(
              "h-[7px] w-[7px] rounded-full",
              set.has(d)
                ? "bg-primary"
                : d === today
                  ? "border border-muted-foreground/70" // today, still open
                  : d > today
                    ? "bg-muted-foreground/15"
                    : "bg-muted-foreground/30",
            )}
          />
        );
      })}
    </span>
  );
}

/**
 * Everyone in the JF crew, by who's training: training now, the coach, then
 * whoever trained most recently. Each row says when they last trained (only
 * within the week; a quiet stretch is never shown) and dots for the days they
 * trained this week. Posts aren't the measure here: most people train far
 * more than they post. Tap anyone for their profile. No counts to compete on.
 */
export function CrewList({ onOpen, onOpenMe }: { onOpen: (a: CommunityAuthor) => void; onOpenMe?: () => void }) {
  const { data: members, isLoading, isError, refetch } = useCommunityMembers(true);
  const { data: goal } = useCrewGoal(true);
  const { user } = useAuth();
  const { data: me } = useCommunityProfile(onOpenMe ? (user?.id ?? null) : null);

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

  const today = communityIsoDow();
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b border-border/60 px-3.5 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{members.length + 1} in the JF crew</span>
        {goal && goal.people > 0 && <span className="shrink-0 text-[11px] font-bold text-primary">{goal.people} trained this week</span>}
      </div>
      <div className="divide-y divide-border/60">
        {/* you first: your profile, your posts, your photo and bio */}
        {onOpenMe && me && (
          <button type="button" data-crew-me onClick={onOpenMe} className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-muted">
            <UserAvatar src={me.author.avatar_url} name={me.author.name} size={44} expandable={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold">You</span>
              <span className="block truncate text-[12px] text-muted-foreground">Your profile · {me.posts === 1 ? "1 post" : `${me.posts ?? 0} posts`}</span>
            </span>
          </button>
        )}
        {members.map((m) => (
          <CrewRow key={m.author.user_id} m={m} today={today} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function CrewRow({ m, today, onOpen }: { m: CommunityMember; today: number; onOpen: (a: CommunityAuthor) => void }) {
  const activity = m.live ? null : trainedLabel(m.trained_at);
  const about = m.bio || (m.author.is_coach ? m.author.title || "Coach · JF Effect" : null) || trainingSinceLabel(m.training_since) || "In the JF crew";
  const days = m.week_days ?? [];
  return (
    <button type="button" data-crew-row onClick={() => onOpen(m.author)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-muted">
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
          {m.live ? (
            <span className="font-bold text-red-500">Training now</span>
          ) : activity ? (
            <span className="font-semibold text-foreground/80">{activity}</span>
          ) : null}
          {(m.live || activity) && " · "}
          {about}
        </span>
      </span>
      {days.length > 0 && <WeekDots days={days} today={today} />}
    </button>
  );
}
