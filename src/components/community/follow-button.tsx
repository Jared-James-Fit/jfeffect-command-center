import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import type { CommunityAuthor } from "@/lib/community";
import { useCommunityMembers } from "@/lib/community.queries";
import { useFollow, useFollowState } from "@/lib/community-social";

/**
 * Instagram-style Follow: "Follow" (or "Follow back" when they follow you),
 * then a quiet "Following". Unfollowing is one tap with an Undo, so a slip is
 * never a problem. Nothing public: no counts, nobody else sees it.
 */
export function FollowButton({ userId, name, size = "md", tone = "solid", className }: {
  userId: string;
  name?: string;
  size?: "sm" | "md";
  /** soft: a quiet tint for long lists, where a column of solid buttons would shout */
  tone?: "solid" | "soft";
  className?: string;
}) {
  const { data: state } = useFollowState();
  const follow = useFollow();
  const following = !!state?.following.includes(userId);
  const followsYou = !!state?.followers.includes(userId);
  const set = (on: boolean) =>
    follow.mutate(
      { userId, on },
      {
        onError: () => toast.error(on ? "Couldn't follow. Try again." : "Couldn't unfollow. Try again."),
        onSuccess: () => {
          if (!on) toast(`Unfollowed${name ? ` ${name}` : ""}`, { action: { label: "Undo", onClick: () => follow.mutate({ userId, on: true }) } });
        },
      },
    );
  return (
    <button
      type="button"
      data-follow={following ? "following" : "follow"}
      aria-pressed={following}
      onClick={(e) => {
        e.stopPropagation();
        set(!following);
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-bold transition active:scale-[0.97]",
        size === "sm" ? "h-8 min-w-[72px] px-3 text-[12px]" : "h-9 min-w-[96px] px-4 text-[13px]",
        following ? "bg-muted text-foreground" : tone === "soft" ? "bg-primary/10 text-primary" : "bg-primary text-primary-foreground",
        className,
      )}
    >
      {following ? "Following" : followsYou ? "Follow back" : "Follow"}
    </button>
  );
}

/** "Follows you", next to a name. */
export function FollowsYouTag({ userId, className }: { userId: string; className?: string }) {
  const { data: state } = useFollowState();
  if (!state?.followers.includes(userId)) return null;
  return <span className={cn("shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground", className)}>Follows you</span>;
}

/**
 * Your own profile: "Following · N", opening the list (only you ever see it).
 * Each row can be unfollowed in place; tap a name for their profile.
 */
export function MyFollowing({ onOpen }: { onOpen: (a: CommunityAuthor) => void }) {
  const { data: state } = useFollowState();
  const [open, setOpen] = useState(false);
  const { data: members = [] } = useCommunityMembers(open);
  const ids = state?.following ?? [];
  const people = ids.map((id) => members.find((m) => m.author.user_id === id)).filter((m): m is NonNullable<typeof m> => !!m);
  return (
    <>
      <button type="button" data-my-following onClick={() => setOpen(true)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-muted px-3 text-[12px] font-bold active:bg-muted/70">
        Following <span className="tabular-nums text-muted-foreground">· {ids.length}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" hideCloseButton className="max-h-[80dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 pb-safe-bottom sm:mx-auto sm:max-w-[520px]">
          <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 px-5 pb-1 pt-4 text-left">
            <div className="min-w-0">
              <SheetTitle className="text-[16px] font-black">Following</SheetTitle>
              <SheetDescription className="text-[12px]">Only you see this list. People you follow come first in Stories and under Following.</SheetDescription>
            </div>
            <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </SheetClose>
          </SheetHeader>
          {ids.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">You're not following anyone yet. Tap Follow on someone's profile or in Members.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border/60 border-y border-border/60">
              {people.map((m) => (
                <li key={m.author.user_id} className="flex items-center gap-3 px-5 py-2.5">
                  <button type="button" onClick={() => { setOpen(false); onOpen(m.author); }} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70">
                    <UserAvatar src={m.author.avatar_url} name={m.author.name} size={40} expandable={false} />
                    <span className="min-w-0 truncate text-[14px] font-bold">{m.author.name}</span>
                    <FollowsYouTag userId={m.author.user_id} />
                  </button>
                  <FollowButton userId={m.author.user_id} name={m.author.name} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
