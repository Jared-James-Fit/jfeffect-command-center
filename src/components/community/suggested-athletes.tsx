import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge } from "@/components/community/post-card";
import { FollowButton } from "@/components/community/follow-button";
import { trainedLabel, type CommunityAuthor } from "@/lib/community";
import { useCommunityMembers } from "@/lib/community.queries";
import { suggestAthletes, useFollowState } from "@/lib/community-social";

/** Below this many follows, the feed suggests people (Instagram's "Suggested for you"). */
export const SUGGEST_UNTIL_FOLLOWING = 5;

/**
 * "Suggested for you": a sideways row of people in the crew you don't follow
 * yet. Whoever follows you comes first, then whoever's training most this week.
 * Shows in the feed until you follow a handful; tap a card for their profile.
 */
export function SuggestedAthletes({ onOpen }: { onOpen: (a: CommunityAuthor) => void }) {
  const { data: state } = useFollowState();
  const enough = (state?.following.length ?? 0) >= SUGGEST_UNTIL_FOLLOWING;
  const { data: members = [] } = useCommunityMembers(!!state && !enough);
  if (!state || enough) return null;
  const people = suggestAthletes(members, state);
  if (people.length === 0) return null;
  return (
    <section data-suggested className="-mx-3 border-y border-border/60 py-3 sm:mx-0 sm:rounded-3xl sm:border">
      <div className="flex items-baseline justify-between px-4">
        {/* follower / following lists are on profiles now, so no "only you see who you follow" */}
        <h3 className="text-[14px] font-black">Suggested for you</h3>
      </div>
      <div className="mt-2.5 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {people.map((m) => {
          const followsYou = state.followers.includes(m.author.user_id);
          const sub = followsYou ? "Follows you" : trainedLabel(m.trained_at ?? null) ?? (m.week_days?.length ? `${m.week_days.length}× this week` : "In the crew");
          return (
            <div key={m.author.user_id} className="flex w-[148px] shrink-0 snap-start flex-col items-center rounded-2xl border border-border/70 bg-card px-3 pb-3 pt-4 text-center">
              <button type="button" onClick={() => onOpen(m.author)} className="flex min-w-0 flex-col items-center active:opacity-80">
                <UserAvatar src={m.author.avatar_url} name={m.author.name} size={64} expandable={false} />
                <span className="mt-2 flex w-full min-w-0 items-center justify-center gap-1">
                  <span className="truncate text-[13px] font-bold">{m.author.name}</span>
                  {m.author.is_coach && <CoachBadge className="h-3.5 w-3.5" />}
                </span>
                <span className="mt-0.5 w-full truncate text-[11px] text-muted-foreground">{sub}</span>
              </button>
              <FollowButton userId={m.author.user_id} name={m.author.name} size="sm" className="mt-2.5 w-full" />
            </div>
          );
        })}
      </div>
    </section>
  );
}
