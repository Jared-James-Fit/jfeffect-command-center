import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MentionText } from "@/components/community/mentions";
import type { CommunityAuthor, CommunityMention } from "@/lib/community";

/** The caption in the feed: three lines, then "more" opens the rest in place (like Instagram). */
export function FeedCaption({
  name,
  caption,
  mentions,
  onOpenPerson,
}: {
  name: string;
  caption: string;
  mentions?: CommunityMention[] | null;
  onOpenPerson?: (a: CommunityAuthor) => void;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [caption, open]);
  return (
    <div className="px-3.5 pt-2.5 text-[14px] leading-snug">
      <p ref={ref} className={cn("whitespace-pre-line", !open && "line-clamp-3")}>
        <span className="font-bold">{name}</span> <MentionText text={caption} mentions={mentions} onOpen={onOpenPerson} />
      </p>
      {long && !open && (
        <button type="button" onClick={() => setOpen(true)} className="mt-0.5 font-semibold text-muted-foreground">
          more
        </button>
      )}
    </div>
  );
}
