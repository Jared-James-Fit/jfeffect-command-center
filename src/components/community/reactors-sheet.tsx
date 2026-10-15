import { BadgeCheck, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { postTimeLabel, reactionEmoji, type CommunityAuthor } from "@/lib/community";
import { usePostReactors } from "@/lib/community.queries";
import { FollowButton } from "@/components/community/follow-button";

/** Everyone who reacted to a post, and with what. Tap someone to open their profile. */
export function ReactorsSheet({
  postId,
  onClose,
  onOpenAuthor,
  title = "Reactions",
}: {
  postId: string | null;
  onClose: () => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
  /** "Celebrated by" on a workout's own row. */
  title?: string;
}) {
  const { data, isLoading } = usePostReactors(postId);
  return (
    <Sheet open={!!postId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[70dvh] gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 px-5 pb-3 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] font-black">{title}{data ? ` · ${data.length}` : ""}</SheetTitle>
            <SheetDescription className="text-[12px]">Everyone who reacted to this</SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>
        <div className="overflow-y-auto px-2 py-2 pb-[max(env(safe-area-inset-bottom),12px)]">
          {isLoading && (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 rounded-xl" />
              ))}
            </div>
          )}
          {data?.map((r) => (
            <div key={r.author.user_id} className="flex w-full items-center gap-2 rounded-xl pr-2 hover:bg-muted" data-reactor-row>
              <button
                type="button"
                disabled={!onOpenAuthor || r.is_me}
                onClick={() => {
                  if (!onOpenAuthor) return;
                  onClose();
                  onOpenAuthor(r.author);
                }}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
              >
                {/* the reaction sits on the photo (Facebook), so it lines up whatever the Follow button says */}
                <span className="relative shrink-0">
                  <UserAvatar src={r.author.avatar_url} name={r.author.name} size={38} expandable={false} />
                  {reactionEmoji(r.emoji) && (
                    <span className="absolute -bottom-1 -right-1 grid h-[20px] w-[20px] place-items-center rounded-full bg-background text-[12px] leading-none shadow-sm" aria-label={`Reacted ${reactionEmoji(r.emoji)}`}>
                      {reactionEmoji(r.emoji)}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1 text-[14px] font-bold">
                    <span className="truncate">{r.is_me ? "You" : r.author.name}</span>
                    {r.author.is_coach && <BadgeCheck className="h-4 w-4 shrink-0 fill-primary text-primary-foreground" aria-label="Coach" />}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{[r.author.title, postTimeLabel(r.created_at)].filter(Boolean).join(" · ")}</div>
                </div>
              </button>
              {/* Instagram's likes list: follow people right from it */}
              {!r.is_me && <FollowButton userId={r.author.user_id} name={r.author.name} avatarUrl={r.author.avatar_url} size="sm" tone="soft" />}
            </div>
          ))}
          {data && data.length === 0 && <div className="p-6 text-center text-[13px] text-muted-foreground">No reactions yet.</div>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
