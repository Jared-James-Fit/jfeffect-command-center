import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MentionText } from "@/components/community/mentions";
import { withHandles, type CommunityMention } from "@/lib/community";
import { choosePreviewStop, cutPreview, previewLine, previewText } from "@/lib/caption-preview";

/** Lines a caption shows on a feed screen before "… more" (Reels'). */
export const PAGE_CAPTION_LINES = 2;

/**
 * A post's words on its own screen of the Crew feed, Reels' way: two lines
 * and "… more". It reads the way it was written (Nov 21 2026): each paragraph
 * starts its own line (never run together into one block), and it stops
 * where a thought does: the opener whole when it fits, else a sentence, else
 * the last word that fits (choosePreviewStop). The whole thing is one tap
 * that opens the post's sheet (the full caption with the comments under it),
 * so a name in it is never its own link here; the sheet has those. Measured
 * at the real width, so it's right on every phone.
 */
export function PageCaption({ text: typed, mentions: typedMentions, onOpen, className }: {
  text: string;
  mentions?: CommunityMention[] | null;
  /** The tap: open the sheet. */
  onOpen: () => void;
  className?: string;
}) {
  const { text, mentions } = useMemo(() => withHandles(previewText(typed), typedMentions), [typed, typedMentions]);
  const box = useRef<HTMLButtonElement | null>(null);
  const probe = useRef<HTMLSpanElement | null>(null);
  const [width, setWidth] = useState(0);
  // characters shown: null = all of it, -1 = no word to stop at (cut by lines)
  const [cut, setCut] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const p = probe.current;
    if (!p || !width) return;
    const lh = parseFloat(getComputedStyle(p).lineHeight) || 15 * 1.4;
    const lines = (t: string) => {
      p.textContent = t;
      return Math.round(p.scrollHeight / lh);
    };
    if (lines(text) <= PAGE_CAPTION_LINES) return setCut(null);
    // the most that fits, "… more" included, stopping where a thought does
    setCut(choosePreviewStop(text, (stop) => lines(previewLine(text, stop)) <= PAGE_CAPTION_LINES));
  }, [text, width]);

  const preview = cut !== null && cut > 0 ? cutPreview(text, cut) : null;
  return (
    <button
      ref={box}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={cn("relative block w-full text-left text-[15px] leading-[1.4]", className)}
      aria-label="Open the caption and comments"
      data-page-caption
    >
      <span className={cn("block whitespace-pre-line break-words", cut === -1 && "line-clamp-2")}>
        <MentionText text={preview ? preview.shown : text} mentions={mentions} />
        {preview && (
          <>
            <span>{preview.gap}… </span>
            <span className="font-semibold opacity-70">more</span>
          </>
        )}
      </span>
      <span
        ref={probe}
        aria-hidden
        className="pointer-events-none invisible absolute inset-x-0 top-0 -z-10 block whitespace-pre-line break-words text-[15px] leading-[1.4]"
      />
    </button>
  );
}
