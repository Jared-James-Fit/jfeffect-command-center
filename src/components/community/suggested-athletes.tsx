import { EyeOff, MoreHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge } from "@/components/community/post-card";
import { FollowButton } from "@/components/community/follow-button";
import { MutualFaces } from "@/components/community/discover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CommunityAuthor } from "@/lib/community";
import { useMyCommunitySettings } from "@/lib/community.queries";
import {
  feedSuggestionsHidden, isStrongReason, reasonLabel, useHideFeedSuggestions, useHideSuggestion, useSuggestions, type DiscoverPerson,
} from "@/lib/community-discover";

/**
 * "Suggested for you": a sideways row of people in the Crew you don't follow
 * yet, each with the reason they're here (your coach, follows you, followed by
 * people you follow with their faces, same gym, new to the Crew…). The server
 * ranks them and leaves out anyone blocked or not suggestable. The × drops
 * someone for good.
 *
 * - In the feed (strongOnly + hideable): only people with a real reason, and
 *   only when there are at least two, so it never fills space with "active this
 *   week". ••• → Hide takes the row off the feed for 30 days (on the account,
 *   every device); Find athletes still shows everyone.
 * - On a profile you just followed (context): people close to them.
 * - At the end of Activity: everyone worth a look.
 */
export function SuggestedAthletes({ onOpen, context = null, strongOnly = false, hideable = false, onSeeAll, onClose, className }: {
  onOpen: (a: CommunityAuthor) => void;
  context?: string | null;
  strongOnly?: boolean;
  /** The feed's row: a ••• menu with Hide. Waits for the setting so a hidden row never flashes in. */
  hideable?: boolean;
  onSeeAll?: () => void;
  /** A close button for the whole row (the profile's "after you follow" strip). */
  onClose?: () => void;
  className?: string;
}) {
  const settings = useMyCommunitySettings(hideable);
  const hiddenFromFeed = hideable && (settings.data === undefined ? !settings.isError : feedSuggestionsHidden(settings.data));
  const { data } = useSuggestions(context, !hiddenFromFeed, 12);
  const hide = useHideSuggestion();
  const hideRow = useHideFeedSuggestions();
  const people = (data ?? []).filter((p) => !strongOnly || isStrongReason(p.reason));
  if (hiddenFromFeed || people.length < (strongOnly ? 2 : 1)) return null;

  const hideFromFeed = () =>
    hideRow.mutate(true, {
      onSuccess: () =>
        toast("Suggestions hidden for 30 days", {
          description: "Find athletes still has everyone.",
          action: { label: "Undo", onClick: () => hideRow.mutate(false) },
        }),
      onError: () => toast.error("Couldn't hide that. Try again."),
    });

  return (
    <section data-suggested className={cn("-mx-3 border-y border-border/60 py-3 sm:mx-0 sm:rounded-3xl sm:border", className)}>
      <div className="flex items-center justify-between gap-2 pl-4 pr-2">
        <h3 className="text-[15px] font-black">Suggested for you</h3>
        <div className="flex items-center">
          {onSeeAll && (
            <button type="button" onClick={onSeeAll} className="px-2 py-1 text-[13px] font-bold text-primary active:opacity-70" data-suggested-all>
              See all
            </button>
          )}
          {hideable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground active:bg-muted" aria-label="More options" data-suggested-more>
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px] rounded-xl">
                <DropdownMenuItem onSelect={hideFromFeed} className="gap-2.5 py-2.5 text-[14px] font-semibold" data-suggested-hide-row>
                  <EyeOff className="h-4 w-4" /> Hide for 30 days
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground active:bg-muted" aria-label="Hide suggestions">
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
  const faces = p.reason?.kind === "followed_by" ? p.mutuals : undefined;
  return (
    <div data-suggestion={p.reason?.kind ?? "crew"} className="relative flex w-[164px] shrink-0 snap-start flex-col items-center rounded-2xl border border-border/70 bg-card px-3 pb-3 pt-5 text-center">
      <button
        type="button"
        onClick={onHide}
        className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full text-muted-foreground/80 active:bg-muted"
        aria-label={`Don't suggest ${p.name}`}
        data-suggestion-hide
      >
        <X className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => onOpen(p)} className="flex w-full min-w-0 flex-col items-center active:opacity-80">
        <UserAvatar src={p.avatar_url} name={p.name} size={84} expandable={false} />
        <span className="mt-2.5 flex w-full min-w-0 items-center justify-center gap-1">
          <span className="truncate text-[14px] font-bold">{p.name}</span>
          {p.is_coach && <CoachBadge className="h-3.5 w-3.5" />}
        </span>
        <span className="mt-1 flex min-h-[30px] w-full min-w-0 items-start justify-center gap-1">
          <MutualFaces m={faces} size={16} className="mt-px" />
          <span className="line-clamp-2 min-w-0 text-[11.5px] leading-[15px] text-muted-foreground">{reasonLabel(p.reason)}</span>
        </span>
      </button>
      <FollowButton userId={p.user_id} name={p.name} avatarUrl={p.avatar_url} isPrivate={p.is_private} size="sm" className="mt-2.5 h-9 w-full" />
    </div>
  );
}
