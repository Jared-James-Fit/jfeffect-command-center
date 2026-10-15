import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Lock, Search, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge } from "@/components/community/post-card";
import { FollowButton } from "@/components/community/follow-button";
import { CrewList } from "@/components/community/crew-list";
import type { CommunityAuthor } from "@/lib/community";
import { reasonLabel, searchTerm, useHideSuggestion, usePeopleSearch, useSuggestions, type DiscoverPerson } from "@/lib/community-discover";

/** The search box waits this long after the last key before asking (feels instant, saves calls). */
const SEARCH_DEBOUNCE_MS = 160;

/**
 * Find athletes (Instagram's search, Strava's Find Friends), one page in Crew:
 * a search box for a first name or @username; with nothing typed, the people
 * worth following (each with why) and then everyone in the Crew. Follow from
 * any row; tap someone for their profile.
 */
export function DiscoverPage({ onBack, onOpen, onOpenMe, autoFocus = false }: {
  onBack: () => void;
  onOpen: (a: CommunityAuthor) => void;
  onOpenMe?: () => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(searchTerm(q)), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [q]);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const searching = searchTerm(q).length > 0;

  return (
    <div className="space-y-3" data-discover>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onBack} className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-full active:bg-muted" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <label className="relative flex h-10 min-w-0 flex-1 items-center rounded-full bg-muted pl-9 pr-1">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            ref={input}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or @username"
            aria-label="Search athletes"
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground/80 [&::-webkit-search-cancel-button]:hidden"
            data-discover-search
          />
          {q && (
            <button type="button" onClick={() => { setQ(""); input.current?.focus(); }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-background/60" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>

      {searching ? <SearchResults term={term || searchTerm(q)} onOpen={onOpen} /> : (
        <>
          <SuggestedList onOpen={onOpen} />
          <CrewList onOpen={onOpen} onOpenMe={onOpenMe} />
        </>
      )}
    </div>
  );
}

function SearchResults({ term, onOpen }: { term: string; onOpen: (a: CommunityAuthor) => void }) {
  const { data, isLoading, isError, refetch } = usePeopleSearch(term);
  if (isLoading) return <RowSkeletons n={3} />;
  if (isError) {
    return (
      <button type="button" onClick={() => void refetch()} className="w-full rounded-2xl border border-border/80 bg-card p-5 text-center text-sm text-muted-foreground">
        Couldn't search. Tap to try again.
      </button>
    );
  }
  if (!data?.length) {
    return (
      <div className="px-6 py-10 text-center" data-discover-empty>
        <div className="text-[15px] font-black">No one called “{term}”</div>
        <p className="mt-1 text-[13px] text-muted-foreground">Try a first name or their @username.</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card" data-discover-results>
      <div className="divide-y divide-border/60">
        {data.map((p) => (
          <PersonRow key={p.user_id} p={p} sub={p.follows_you ? "Follows you" : null} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

/** With nothing typed: the best few to follow, each with why. Nothing at all when there's no one to suggest. */
function SuggestedList({ onOpen }: { onOpen: (a: CommunityAuthor) => void }) {
  const { data, isLoading } = useSuggestions(null, true, 12);
  const hide = useHideSuggestion();
  const [more, setMore] = useState(false);
  if (isLoading) return <RowSkeletons n={2} />;
  const people = data ?? [];
  if (!people.length) return null;
  const shown = more ? people : people.slice(0, 5);
  return (
    <section aria-label="Suggested for you" data-discover-suggested>
      <h2 className="mb-1.5 px-1 text-[15px] font-black">Suggested for you</h2>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="divide-y divide-border/60">
          {shown.map((p) => (
            <PersonRow key={p.user_id} p={p} sub={reasonLabel(p.reason)} onOpen={onOpen} onHide={() => hide.mutate(p.user_id)} />
          ))}
        </div>
        {people.length > shown.length && (
          <button type="button" onClick={() => setMore(true)} className="h-11 w-full border-t border-border/60 text-[13px] font-bold text-primary active:bg-muted">
            Show {people.length - shown.length} more
          </button>
        )}
      </div>
    </section>
  );
}

/** A person: photo, name (coach badge, lock when private), why / "Follows you" then @username, Follow. */
export function PersonRow({ p, sub, onOpen, onHide }: { p: DiscoverPerson; sub?: string | null; onOpen: (a: CommunityAuthor) => void; onHide?: () => void }) {
  // the reason first: it's what decides a follow, and the line truncates from the end
  const line = [sub, p.username ? `@${p.username}` : null].filter(Boolean).join(" · ");
  return (
    <div data-person-row className="flex w-full items-center gap-2 pr-2.5">
      <button type="button" onClick={() => onOpen(p)} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3.5 text-left active:bg-muted">
        <UserAvatar src={p.avatar_url} name={p.name} size={44} expandable={false} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[15px] font-bold">{p.name}</span>
            {p.is_coach && <CoachBadge />}
            {p.is_private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Private account" />}
          </span>
          {/* two lines on narrow phones, so the reason isn't cut to "Follo…" */}
          {line && <span className="line-clamp-2 text-[12px] [overflow-wrap:anywhere] leading-snug text-muted-foreground">{line}</span>}
        </span>
      </button>
      <FollowButton userId={p.user_id} name={p.name} avatarUrl={p.avatar_url} isPrivate={p.is_private} size="sm" tone="soft" />
      {onHide && (
        <button type="button" onClick={onHide} className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground/80 active:bg-muted" aria-label={`Don't suggest ${p.name}`} data-suggestion-hide>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function RowSkeletons({ n }: { n: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  );
}
