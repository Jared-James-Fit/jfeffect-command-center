import { Plus, Send, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CommunityPost } from "@/lib/community";

/**
 * Instagram's share sheet (a post's ✈️): Add to story first, then Message
 * the person who posted it. Each one closes the sheet and opens its own
 * screen (the story camera with the post on it, or the message sheet).
 */
export function PostShareSheet({ post, open, onOpenChange, onStory, onMessage }: {
  post: CommunityPost;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStory?: () => void;
  onMessage?: () => void;
}) {
  const first = post.author.name.split(" ")[0] || post.author.name;
  const options = [
    onStory && {
      key: "story",
      label: "Add to story",
      run: onStory,
      icon: (
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[conic-gradient(from_200deg,#ef3340,#f97316,#facc15,#ef3340)] p-[2.5px]">
          <span className="grid h-full w-full place-items-center rounded-full bg-background">
            <Plus className="h-6 w-6" strokeWidth={2.6} />
          </span>
        </span>
      ),
    },
    onMessage && {
      key: "message",
      label: `Message ${first}`,
      run: onMessage,
      icon: (
        <span className="grid h-14 w-14 place-items-center rounded-full bg-muted">
          <Send className="h-6 w-6 -rotate-12" />
        </span>
      ),
    },
  ].filter(Boolean) as { key: string; label: string; run: () => void; icon: React.ReactNode }[];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]" data-post-share-sheet>
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 px-5 pb-1 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] font-black">Share</SheetTitle>
            <SheetDescription className="sr-only">Add this post to your story, or message {first}</SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>
        <div className="flex gap-5 px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-3">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                onOpenChange(false);
                o.run();
              }}
              className="flex w-[76px] flex-col items-center gap-1.5 text-center active:scale-95"
              data-share-option={o.key}
            >
              {o.icon}
              <span className="line-clamp-2 text-[12px] font-semibold leading-tight">{o.label}</span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
