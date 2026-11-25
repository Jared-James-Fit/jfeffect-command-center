import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useBlockPerson } from "@/lib/direct-chats";
import { refreshAfterBlock } from "@/lib/crew-safety";
import type { CommunityAuthor } from "@/lib/community";

/**
 * Block or unblock someone, after a confirm. A block works both ways and
 * quietly: they can't find you, see your posts, stories or comments, follow
 * or message you, and you won't see theirs (Rankings too). They aren't told.
 * Coaches can't be blocked. Used by a profile's ••• and a post's ⋯.
 */
export function BlockConfirmSheet({ author, blocked, open, onOpenChange, onDone }: {
  author: CommunityAuthor;
  blocked: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const block = useBlockPerson();
  const qc = useQueryClient();
  const run = () =>
    block.mutate(
      { userId: author.user_id, blocked: !blocked },
      {
        onSuccess: () => {
          toast(blocked ? `${author.name} is unblocked` : `Blocked ${author.name}`);
          // who you can see, find and follow all change with it
          refreshAfterBlock(qc);
          onDone?.();
        },
        onError: (e: any) => toast.error(e?.message ?? "That didn't work. Try again."),
      },
    );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="gap-0 rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:mx-auto sm:max-w-[420px]">
        <div className="flex flex-col items-center px-6 pb-3 pt-6 text-center">
          <UserAvatar src={author.avatar_url} name={author.name} size={64} expandable={false} />
          <SheetTitle className="mt-3 text-[16px] font-bold">{blocked ? `Unblock ${author.name}?` : `Block ${author.name}?`}</SheetTitle>
          <SheetDescription className="mt-1 text-[13px] leading-snug">
            {blocked
              ? "They'll be able to find you, see your posts and message you again, and follows between you work again."
              : "They won't be able to find you, see your posts, stories or comments, follow you or message you, and you won't see theirs. They won't be told."}
          </SheetDescription>
        </div>
        <div className="border-t border-border/60">
          <button
            type="button"
            disabled={block.isPending}
            onClick={() => {
              onOpenChange(false);
              run();
            }}
            className={cn("h-12 w-full text-[14px] font-bold active:bg-muted", !blocked && "text-destructive")}
            data-block-confirm
          >
            {blocked ? "Unblock" : "Block"}
          </button>
          <SheetClose className="h-12 w-full border-t border-border/60 text-[14px] font-semibold active:bg-muted">Cancel</SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
