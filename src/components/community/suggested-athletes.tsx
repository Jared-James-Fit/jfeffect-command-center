import { X } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge } from "@/components/community/post-card";
import { FollowButton } from "@/components/community/follow-button";
import { cn } from "@/lib/utils";
import type { CommunityAuthor } from "@/lib/community";
import { isStrongReason, reasonLabel, useHideSuggestion, useSuggestions, type DiscoverPerson } from "@/lib/community-discover";

/**
 * "Suggested for you": a sideways row of people in the Crew you don't follow
 * yet, each with the reason they're here (your coach, follows you, followed by
 * people you follow, same gym, new to the Crew…). The server ranks them and
 * leaves out anyone blocked or not suggestable. The × drops someone for good.
 *
 * - In the feed (strongOnly): only people with a real reason, and only when
 *   there are at least two, so it never fills space with "active this week".
 * - On a profile you just followed (context): people close to them.
 * - At the end of Activity: everyone worth a look.
 */
export function SuggestedAthletes({ onOpen, context = null, strongOnly = false, onSeeAll, onClose, className }: {
  onOpen: (a: CommunityAuthor) => void;
  context?: string | null;
  strongOnly?: boolean;
  onSeeAll?: () => void;
  /** A close button for the whole row (the profile's "after you follow" strip). */
  onClose?: () => void;
  className?: string;
}) {
  const { data } = useSuggestions(context, true, 12);
  const hide = useHideSuggestion();
  const people = (data ?? []).filter((p) => !strongOnly || isStrongReason(p.reason));
  if (people.length < (strongOnly ? 2 : 1)) return null;
  return (
    <section data-suggested className={cn("-mx-3 border-y border-border/60 py-3 sm:mx-0 sm:rounded-3xl sm:border", className)}>
      <div className="flex items-center justify-between gap-2 px-4">
        <h3 className="text-[14px] font-black">Suggested for you</h3>
        <div className="flex items-center gap-1">
          {onSeeAll && (
            <button type="button" onClick={onSeeAll} className="text-[13px] font-bold text-primary active:opacity-70" data-suggested-all>
              See all
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className="-mr-1.5 grid h-8 w-8 place-items-center rounded-full text-muted-foreground active:bg-muted" aria-label="Hide suggestions">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {people.map((p) => (
          <SuggestionCard key={p.user_id} p={p} onOpen={onOpen} onHide={() => hide.mutate(p.user_id)} />
        ))}
      </div>
    </section>
  );
}

function SuggestionCard({ p, onOpen, onHide }: { p: DiscoverPerson; onOpen: (a: CommunityAuthor) => void; onHide: () => void }) {
  return (
    <div data-suggestion={p.reason?.kind ?? "crew"} className="relative flex w-[148px] shrink-0 snap-start flex-col items-center rounded-2xl border border-border/70 bg-card px-3 pb-3 pt-4 text-center">
      <button
        type="button"
        onClick={onHide}
        className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full text-muted-foreground/80 active:bg-muted"
        aria-label={`Don't suggest ${p.name}`}
        data-suggestion-hide
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => onOpen(p)} className="flex w-full min-w-0 flex-col items-center active:opacity-80">
        <UserAvatar src={p.avatar_url} name={p.name} size={64} expandable={false} />
        <span className="mt-2 flex w-full min-w-0 items-center justify-center gap-1">
          <span className="truncate text-[13px] font-bold">{p.name}</span>
          {p.is_coach && <CoachBadge className="h-3.5 w-3.5" />}
        </span>
        <span className="mt-0.5 line-clamp-2 min-h-[28px] w-full text-[11px] leading-[14px] text-muted-foreground">{reasonLabel(p.reason)}</span>
      </button>
      <FollowButton userId={p.user_id} name={p.name} avatarUrl={p.avatar_url} isPrivate={p.is_private} size="sm" className="mt-2 w-full" />
    </div>
  );
}
