import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MentionText } from "@/components/community/mentions";
import { captionBreaks, withHandles, type CommunityAuthor, type CommunityMention } from "@/lib/community";

/** Up to this many lines, a coach post's words show whole in the feed. */
export const NOTE_SHOW_ALL_LINES = 12;
/** Longer: as much as fits in this many lines, ending on a full sentence, then "… more". */
export const NOTE_CUT_LINES = 9;

/**
 * A coach post's words in the feed. Short ones (every daily, holiday and
 * birthday post) show whole. A long one stops at the end of a sentence or
 * paragraph, never mid-thought, with "… more" right after it to open the
 * rest in place. Measured at the card's real width, so it's right on every
 * phone. `clamp` off (the post's own page) shows everything.
 */
export function NoteCaption({
  text: typed,
  mentions: typedMentions,
  onOpenPerson,
  clamp,
}: {
  text: string;
  mentions?: CommunityMention[] | null;
  onOpenPerson?: (a: CommunityAuthor) => void;
  clamp: boolean;
}) {
  // measured and cut as it reads: tags as @usernames
  const { text, mentions } = useMemo(() => withHandles(typed, typedMentions), [typed, typedMentions]);
  const box = useRef<HTMLDivElement | null>(null);
  const probe = useRef<HTMLParagraphElement | null>(null);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState(false);
  // characters shown: null = all of it, -1 = no clean place to stop (clamp by lines)
  const [cut, setCut] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!clamp || !el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [clamp]);

  useLayoutEffect(() => {
    const p = probe.current;
    if (!clamp || open || !p || !width) return setCut(null);
    const lh = parseFloat(getComputedStyle(p).lineHeight) || 15 * 1.45;
    const lines = (t: string) => {
      p.textContent = t;
      return Math.round(p.scrollHeight / lh);
    };
    if (lines(text) <= NOTE_SHOW_ALL_LINES) return setCut(null);
    // the longest clean stop that still fits, "… more" included
    const breaks = captionBreaks(text);
    let lo = 0;
    let hi = breaks.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines(text.slice(0, breaks[mid]).trimEnd() + "… more") <= NOTE_CUT_LINES) {
        best = breaks[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    // stopping after a line or two hides the point: cut by lines instead
    setCut(best > 0 && lines(text.slice(0, best).trimEnd() + "… more") >= 3 ? best : -1);
  }, [text, width, open, clamp]);

  const more = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setOpen(true);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="font-semibold text-muted-foreground"
    >
      more
    </button>
  );
  const shown = cut !== null && cut > 0 ? text.slice(0, cut).trimEnd() : text;

  return (
    <div ref={box} className="relative">
      <p
        className={cn(
          "whitespace-pre-line text-[15px] leading-[1.45]",
          cut === -1 && "line-clamp-[9]",
        )}
      >
        <MentionText text={shown} mentions={mentions} onOpen={onOpenPerson} />
        {cut !== null && cut > 0 && (
          <>
            <span className="text-muted-foreground">… </span>
            {more}
          </>
        )}
      </p>
      {cut === -1 && <div className="text-[15px] leading-[1.45]">{more}</div>}
      {clamp && (
        <p
          ref={probe}
          aria-hidden
          className="pointer-events-none invisible absolute inset-x-0 top-0 -z-10 whitespace-pre-line text-[15px] leading-[1.45]"
        />
      )}
    </div>
  );
}
