import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Star, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import type { CommunityAuthor } from "@/lib/community";
import { useCommunityMembers, useMyCommunityId } from "@/lib/community.queries";
import {
  followLabel, useFollow, useFollowList, useFollowState, useRemoveFollower, useRespondToFollow, useSetCloseFriend,
  type FollowListKind,
} from "@/lib/community-social";

/**
 * Instagram-style Follow: "Follow" (or "Follow back" when they follow you),
 * "Requested" while a private account decides (tap again to cancel), then a
 * quiet "Following". Unfollowing is one tap with an Undo; on a private account
 * it asks first, because coming back means asking again.
 */
export function FollowButton({ userId, name, avatarUrl, isPrivate, size = "md", tone = "solid", className }: {
  userId: string;
  name?: string;
  avatarUrl?: string | null;
  /** Their account is private: a tap sends a request, and unfollowing asks first. */
  isPrivate?: boolean;
  size?: "sm" | "md";
  /** soft: a quiet tint for long lists, where a column of solid buttons would shout */
  tone?: "solid" | "soft";
  className?: string;
}) {
  const { data: state } = useFollowState();
  const follow = useFollow();
  const [confirm, setConfirm] = useState(false);
  const label = followLabel(state, userId);
  const on = label === "Following" || label === "Requested";
  const set = (next: boolean) =>
    follow.mutate(
      { userId, on: next, isPrivate },
      {
        onError: () => toast.error(next ? "Couldn't follow. Try again." : label === "Requested" ? "Couldn't cancel the request. Try again." : "Couldn't unfollow. Try again."),
        onSuccess: (s) => {
          if (next && s.requested.includes(userId)) toast(`Requested${name ? ` to follow ${name}` : ""}`, { description: "You'll see their posts once they confirm." });
          if (!next && label === "Following")
            toast(`Unfollowed${name ? ` ${name}` : ""}`, isPrivate ? undefined : { action: { label: "Undo", onClick: () => follow.mutate({ userId, on: true, isPrivate }) } });
        },
      },
    );
  return (
    <>
      <button
        type="button"
        data-follow={label === "Following" ? "following" : label === "Requested" ? "requested" : "follow"}
        aria-pressed={on}
        onClick={(e) => {
          e.stopPropagation();
          if (label === "Following" && isPrivate) setConfirm(true);
          else set(!on);
        }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg font-bold transition active:scale-[0.97]",
          size === "sm" ? "h-8 min-w-[72px] px-3 text-[12px]" : "h-9 min-w-[96px] px-4 text-[13px]",
          on ? "bg-muted text-foreground" : tone === "soft" ? "bg-primary/10 text-primary" : "bg-primary text-primary-foreground",
          className,
        )}
      >
        {label}
      </button>
      {isPrivate && (
        <Sheet open={confirm} onOpenChange={setConfirm}>
          <SheetContent side="bottom" hideCloseButton className="gap-0 rounded-t-[24px] p-0 pb-safe-bottom sm:mx-auto sm:max-w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div data-unfollow-confirm className="flex flex-col items-center px-6 pb-3 pt-6 text-center">
              <UserAvatar src={avatarUrl ?? null} name={name ?? ""} size={72} expandable={false} />
              <SheetTitle className="mt-3 text-[16px] font-black">Unfollow{name ? ` ${name}` : ""}?</SheetTitle>
              <SheetDescription className="mt-1 text-[13px] leading-snug">
                Their account is private. If you change your mind, you'll have to request to follow{name ? ` ${name}` : " them"} again.
              </SheetDescription>
            </div>
            <div className="border-t border-border/60">
              <button type="button" onClick={() => { setConfirm(false); set(false); }} className="h-12 w-full text-[14px] font-bold text-destructive active:bg-muted">
                Unfollow
              </button>
              <SheetClose className="h-12 w-full border-t border-border/60 text-[14px] font-semibold active:bg-muted">Cancel</SheetClose>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

/** "Follows you", next to a name. */
export function FollowsYouTag({ userId, className }: { userId: string; className?: string }) {
  const { data: state } = useFollowState();
  if (!state?.followers.includes(userId)) return null;
  return <span className={cn("shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground", className)}>Follows you</span>;
}

/** "N followers · N following" on a profile; opens the lists when you're allowed to see them. */
export function FollowCounts({ userId, isMe, canSee, followers, following, onOpen }: {
  userId: string;
  isMe: boolean;
  canSee: boolean;
  followers: number;
  following: number;
  onOpen?: (a: CommunityAuthor) => void;
}) {
  const [open, setOpen] = useState<FollowListKind | null>(null);
  const stat = (n: number, one: string, many: string, kind: FollowListKind) => (
    <button
      type="button"
      disabled={!canSee}
      data-follow-count={kind}
      onClick={() => setOpen(kind)}
      className="inline-flex items-baseline gap-1 text-[13px] disabled:cursor-default"
    >
      <span className="font-black tabular-nums">{n}</span>
      <span className="text-muted-foreground">{n === 1 ? one : many}</span>
    </button>
  );
  return (
    <>
      <div className="mt-1.5 flex items-center gap-3">
        {stat(followers, "follower", "followers", "followers")}
        {stat(following, "following", "following", "following")}
      </div>
      <FollowListSheet userId={userId} isMe={isMe} kind={open} onKind={setOpen} onOpen={onOpen} />
    </>
  );
}

function SheetTop({ title, sub }: { title: string; sub?: string }) {
  return (
    <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 px-5 pb-1 pt-4 text-left">
      <div className="min-w-0">
        <SheetTitle className="text-[16px] font-black">{title}</SheetTitle>
        <SheetDescription className={cn("text-[12px]", !sub && "sr-only")}>{sub ?? title}</SheetDescription>
      </div>
      <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
        <X className="h-4 w-4" />
      </SheetClose>
    </SheetHeader>
  );
}

const SHEET = "max-h-[80dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 pb-safe-bottom sm:mx-auto sm:max-w-[520px]";

function PersonRow({ a, onOpen, children }: { a: CommunityAuthor; onOpen?: () => void; children?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <button type="button" onClick={onOpen} disabled={!onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70 disabled:active:opacity-100">
        <UserAvatar src={a.avatar_url} name={a.name} size={40} expandable={false} />
        <span className="min-w-0 truncate text-[14px] font-bold">{a.name}</span>
        <FollowsYouTag userId={a.user_id} />
      </button>
      {children}
    </li>
  );
}

/** Followers / Following, Instagram-style. On your own, Remove a follower or unfollow in place. */
function FollowListSheet({ userId, isMe, kind, onKind, onOpen }: {
  userId: string;
  isMe: boolean;
  kind: FollowListKind | null;
  onKind: (k: FollowListKind | null) => void;
  onOpen?: (a: CommunityAuthor) => void;
}) {
  const { data: people = [], isLoading } = useFollowList(userId, kind ?? "followers", !!kind);
  const remove = useRemoveFollower();
  const myId = useMyCommunityId();
  return (
    <Sheet open={!!kind} onOpenChange={(o) => !o && onKind(null)}>
      <SheetContent side="bottom" hideCloseButton className={SHEET}>
        <SheetTop title={kind === "following" ? "Following" : "Followers"} />
        <div className="mx-5 mt-2 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="tablist">
          {(["followers", "following"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => onKind(k)}
              className={cn("h-8 rounded-lg text-[12px] font-bold capitalize", kind === k ? "bg-background shadow-sm" : "text-muted-foreground")}>
              {k}
            </button>
          ))}
        </div>
        {isLoading ? (
          <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">Loading…</p>
        ) : people.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">{kind === "following" ? "Not following anyone yet." : "No followers yet."}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60 border-y border-border/60">
            {people.map((a) => (
              <PersonRow key={a.user_id} a={a} onOpen={onOpen ? () => { onKind(null); onOpen(a); } : undefined}>
                {isMe && kind === "followers" ? (
                  <button
                    type="button"
                    className="h-8 shrink-0 rounded-lg bg-muted px-3 text-[12px] font-bold"
                    onClick={() => remove.mutate({ userId: a.user_id }, { onSuccess: () => toast(`Removed ${a.name}`, { description: "They aren't told." }), onError: () => toast.error("Couldn't remove them. Try again.") })}
                  >
                    Remove
                  </button>
                ) : a.user_id !== myId ? (
                  <FollowButton userId={a.user_id} name={a.name} size="sm" />
                ) : null}
              </PersonRow>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Your own profile, private account: people asking to follow you. Confirm or Delete (silent). */
export function FollowRequestsButton({ onOpen }: { onOpen?: (a: CommunityAuthor) => void }) {
  const { data: state } = useFollowState();
  const [open, setOpen] = useState(false);
  const { data: members = [], isLoading: membersLoading } = useCommunityMembers(open);
  const respond = useRespondToFollow();
  const ids = state?.requests ?? [];
  if (!ids.length && !open) return null;
  const people = ids.map((id) => members.find((m) => m.author.user_id === id)?.author).filter((a): a is CommunityAuthor => !!a);
  return (
    <>
      <button type="button" data-follow-requests onClick={() => setOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-[12px] font-bold text-primary">
        Requests <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] text-primary-foreground tabular-nums">{ids.length}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" hideCloseButton className={SHEET}>
          <SheetTop title="Follow requests" sub="Deleting a request is silent. They can ask again later." />
          {ids.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">No requests right now.</p>
          ) : membersLoading ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">Loading…</p>
          ) : (
            <ul className="mt-3 divide-y divide-border/60 border-y border-border/60">
              {people.map((a) => (
                <PersonRow key={a.user_id} a={a} onOpen={onOpen ? () => { setOpen(false); onOpen(a); } : undefined}>
                  <RespondButtons userId={a.user_id} respond={respond} />
                </PersonRow>
              ))}
            </ul>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function RespondButtons({ userId, respond }: { userId: string; respond: ReturnType<typeof useRespondToFollow> }) {
  const go = (approve: boolean) => respond.mutate({ userId, approve }, { onError: () => toast.error("That didn't save. Try again.") });
  return (
    <div className="flex shrink-0 gap-1.5">
      <button type="button" onClick={() => go(true)} className="h-8 rounded-lg bg-primary px-3 text-[12px] font-bold text-primary-foreground">Confirm</button>
      <button type="button" onClick={() => go(false)} className="h-8 rounded-lg bg-muted px-3 text-[12px] font-bold">Delete</button>
    </div>
  );
}

/** Confirm / Delete for a waiting request (gone once it's answered). */
export function FollowRequestActions({ userId }: { userId: string }) {
  const { data: state } = useFollowState();
  const respond = useRespondToFollow();
  if (!state?.requests.includes(userId)) return null;
  return <RespondButtons userId={userId} respond={respond} />;
}

/** On someone's profile when they've asked to follow you. */
export function FollowRequestBanner({ userId, name }: { userId: string; name: string }) {
  const { data: state } = useFollowState();
  const respond = useRespondToFollow();
  if (!state?.requests.includes(userId)) return null;
  return (
    <div data-follow-request-banner className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-2.5">
      <span className="min-w-0 text-[13px] font-semibold">{name} wants to follow you</span>
      <RespondButtons userId={userId} respond={respond} />
    </div>
  );
}

/**
 * Your Close Friends: who gets your Close Friends posts and stories (green
 * ring). Nobody is told they were added or taken off.
 */
export function CloseFriendsButton() {
  const { data: state } = useFollowState();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: members = [] } = useCommunityMembers(open);
  const set = useSetCloseFriend();
  const ids = useMemo(() => state?.close_friends ?? [], [state?.close_friends]);
  const list = useMemo(() => {
    const on = new Set(ids);
    const term = q.trim().toLowerCase();
    const people = members.map((m) => m.author).filter((a) => a && !a.is_coach);
    // on the list first, then people you follow / who follow you, then everyone else by name
    const rank = (a: CommunityAuthor) => (on.has(a.user_id) ? 0 : state?.following.includes(a.user_id) || state?.followers.includes(a.user_id) ? 1 : 2);
    return people
      .filter((a) => (term ? a.name.toLowerCase().includes(term) : rank(a) < 2))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .slice(0, 60);
  }, [members, ids, q, state]);
  return (
    <>
      <button type="button" data-close-friends onClick={() => setOpen(true)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-500/15 px-3 text-[12px] font-bold text-emerald-700 dark:text-emerald-300">
        <Star className="h-3.5 w-3.5 fill-current" /> Close friends <span className="tabular-nums opacity-70">· {ids.length}</span>
      </button>
      <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
        <SheetContent side="bottom" hideCloseButton className={SHEET}>
          <SheetTop title="Close friends" sub="Pick Close friends when you post and only these people see it, with a green ring on your story. Nobody is told they're on it." />
          <label className="mx-5 mt-2 flex h-10 items-center gap-2 rounded-xl bg-muted px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the crew" className="min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm" />
          </label>
          {list.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">{q ? "Nobody in the crew by that name." : "Follow people, then add them here. Or search the crew."}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border/60 border-y border-border/60">
              {list.map((a) => {
                const on = ids.includes(a.user_id);
                return (
                  <PersonRow key={a.user_id} a={a}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => set.mutate({ userId: a.user_id, on: !on }, { onError: () => toast.error("That didn't save. Try again.") })}
                      className={cn("h-8 shrink-0 rounded-lg px-3 text-[12px] font-bold", on ? "bg-emerald-500 text-white" : "bg-muted")}
                    >
                      {on ? "Added" : "Add"}
                    </button>
                  </PersonRow>
                );
              })}
            </ul>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
