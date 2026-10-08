import { BadgeCheck, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { postTimeLabel, reactionEmoji, type CommunityAuthor } from "@/lib/community";
import { usePostReactors } from "@/lib/community.queries";

/** Everyone who reacted to a post, and with what. Tap someone to open their profile. */
export function ReactorsSheet({
  postId,
  onClose,
  onOpenAuthor,
}: {
  postId: string | null;
  onClose: () => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
}) {
  const { data, isLoading } = usePostReactors(postId);
  return (
    <Sheet open={!!postId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[70dvh] gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 px-5 pb-3 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] font-black">Reactions{data ? ` · ${data.length}` : ""}</SheetTitle>
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
            <button
              key={r.author.user_id}
              type="button"
              disabled={!onOpenAuthor || r.is_me}
              onClick={() => {
                if (!onOpenAuthor) return;
                onClose();
                onOpenAuthor(r.author);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted disabled:hover:bg-transparent"
            >
              <UserAvatar src={r.author.avatar_url} name={r.author.name} size={38} expandable={false} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1 text-[14px] font-bold">
                  <span className="truncate">{r.is_me ? "You" : r.author.name}</span>
                  {r.author.is_coach && <BadgeCheck className="h-4 w-4 shrink-0 fill-primary text-primary-foreground" aria-label="Coach" />}
                </div>
                {r.author.title && <div className="truncate text-[11px] text-muted-foreground">{r.author.title}</div>}
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">{postTimeLabel(r.created_at)}</span>
              {reactionEmoji(r.emoji) && <span className="w-7 shrink-0 text-center text-[20px] leading-none" aria-label={`Reacted ${reactionEmoji(r.emoji)}`}>{reactionEmoji(r.emoji)}</span>}
            </button>
          ))}
          {data && data.length === 0 && <div className="p-6 text-center text-[13px] text-muted-foreground">No reactions yet.</div>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
