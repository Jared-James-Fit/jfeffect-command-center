import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Lock, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge } from "@/components/community/post-card";
import { FollowButton } from "@/components/community/follow-button";
import { CrewList } from "@/components/community/crew-list";
import type { CommunityAuthor } from "@/lib/community";
import { cn } from "@/lib/utils";
import {
  inviteFriends, mutualsLabel, reasonLabel, searchTerm, useFollowBack, useHideSuggestion, usePeopleSearch, useSuggestions, type DiscoverPerson, type Mutuals,
} from "@/lib/community-discover";

/** The search box waits this long after the last key before asking (feels instant, saves calls). */
const SEARCH_DEBOUNCE_MS = 160;

/**
 * Find athletes (Instagram's Discover people, Strava's Find Friends), one page
 * in Crew: a search box for a first name or @username; with nothing typed,
 * Invite friends, the people who follow you that you haven't followed back,
 * the people worth following (each with why, and the faces of people you
 * follow who follow them), then everyone in the Crew. Follow from any row;
 * tap someone for their profile.
 */
export function DiscoverPage({ onBack, onOpen, onOpenMe, autoFocus = false, canInvite = true }: {
  onBack: () => void;
  onOpen: (a: CommunityAuthor) => void;
  onOpenMe?: () => void;
  autoFocus?: boolean;
  /** Not while a coach views as a client. */
  canInvite?: boolean;
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
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
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
          {canInvite && <InviteRow />}
          <FollowBackList onOpen={onOpen} />
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
          <PersonRow key={p.user_id} p={p} sub={p.follows_you ? "Follows you" : mutualsLabel(p.mutuals)} faces={p.follows_you ? undefined : p.mutuals} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

/** Instagram's "Connect contacts", our way: share the membership link with people you already train with. × hides it on this phone for 30 days. */
const INVITE_HIDDEN_KEY = "jf.discover.invite-hidden-until";
function InviteRow() {
  const [hidden, setHidden] = useState(() => {
    try {
      return Number(localStorage.getItem(INVITE_HIDDEN_KEY) ?? 0) > Date.now();
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(INVITE_HIDDEN_KEY, String(Date.now() + 30 * 86_400_000));
    } catch {
      /* private mode: hidden for this visit */
    }
  };
  const invite = async () => {
    const res = await inviteFriends();
    if (res === "copied") toast.success("Invite link copied");
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card py-2.5 pl-3.5 pr-2" data-discover-invite>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-foreground"><UserPlus className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold">Invite friends</span>
        <span className="block truncate text-[12px] text-muted-foreground">Train with your friends</span>
      </span>
      <button type="button" onClick={() => void invite()} className="h-8 shrink-0 rounded-lg bg-primary px-3.5 text-[13px] font-bold text-primary-foreground active:opacity-80">
        Invite
      </button>
      <button type="button" onClick={dismiss} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground/80 active:bg-muted" aria-label="Hide invite">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** People who follow you that you haven't followed back, newest first. Three, then See all. */
function FollowBackList({ onOpen }: { onOpen: (a: CommunityAuthor) => void }) {
  const { data } = useFollowBack();
  const hide = useHideSuggestion();
  const [all, setAll] = useState(false);
  const people = data ?? [];
  if (!people.length) return null;
  const shown = all ? people : people.slice(0, 3);
  return (
    <section aria-label="Follow back" data-discover-follow-back>
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <h2 className="text-[15px] font-black">Follow back</h2>
        {people.length > 3 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="text-[13px] font-bold text-primary active:opacity-70">
            {all ? "Show less" : "See all"}
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="divide-y divide-border/60">
          {shown.map((p) => (
            <PersonRow key={p.user_id} p={p} sub={mutualsLabel(p.mutuals) ?? "Follows you"} faces={p.mutuals} onOpen={onOpen} onHide={() => hide.mutate(p.user_id)} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** With nothing typed: the best few to follow, each with why. Nothing at all when there's no one to suggest. */
function SuggestedList({ onOpen }: { onOpen: (a: CommunityAuthor) => void }) {
  const { data, isLoading } = useSuggestions(null, true, 12);
  const { data: followBack } = useFollowBack();
  const hide = useHideSuggestion();
  const [more, setMore] = useState(false);
  // anyone in Follow back is already up there
  const back = useMemo(() => new Set((followBack ?? []).map((p) => p.user_id)), [followBack]);
  if (isLoading) return <RowSkeletons n={2} />;
  const people = (data ?? []).filter((p) => !back.has(p.user_id));
  if (!people.length) return null;
  const shown = more ? people : people.slice(0, 5);
  return (
    <section aria-label="Suggested for you" data-discover-suggested>
      <h2 className="mb-1.5 px-1 text-[15px] font-black">Suggested for you</h2>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="divide-y divide-border/60">
          {shown.map((p) => (
            <PersonRow key={p.user_id} p={p} sub={reasonLabel(p.reason)} faces={p.reason?.kind === "followed_by" ? p.mutuals : undefined} onOpen={onOpen} onHide={() => hide.mutate(p.user_id)} />
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

/** Up to 3 overlapping faces of people you follow who follow them (Instagram's mutuals). */
export function MutualFaces({ m, size = 18, className }: { m: Mutuals | undefined; size?: number; className?: string }) {
  // photos only: initials at this size read as garbled letters, and the names are in the line next to it anyway
  const faces = (m?.faces ?? []).filter((f) => !!f.avatar_url);
  if (!m?.count || !faces.length) return null;
  return (
    <span className={cn("flex shrink-0 items-center", className)} aria-hidden data-mutual-faces>
      {faces.slice(0, 3).map((f, i) => (
        <span key={f.user_id} className={cn("rounded-full ring-2 ring-card", i > 0 && "-ml-1.5")}>
          <UserAvatar src={f.avatar_url} name={f.name} size={size} expandable={false} />
        </span>
      ))}
    </span>
  );
}

/** A person: photo, name (coach badge, lock when private), why / "Follows you" then @username (mutuals' faces in front), Follow. */
export function PersonRow({ p, sub, faces, onOpen, onHide }: { p: DiscoverPerson; sub?: string | null; faces?: Mutuals; onOpen: (a: CommunityAuthor) => void; onHide?: () => void }) {
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
          {line && (
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <MutualFaces m={faces} />
              <span className="line-clamp-2 min-w-0 text-[12px] [overflow-wrap:anywhere] leading-snug text-muted-foreground">{line}</span>
            </span>
          )}
        </span>
      </button>
      <FollowButton userId={p.user_id} name={p.name} avatarUrl={p.avatar_url} isPrivate={p.is_private} size="sm" />
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
