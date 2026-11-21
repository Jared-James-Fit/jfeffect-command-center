import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MentionText } from "@/components/community/mentions";
import { CaptionText } from "@/components/community/caption-text";
import { captionBreaks, withHandles, type CommunityAuthor, type CommunityMention } from "@/lib/community";
import { cutPreview, previewLine } from "@/lib/caption-preview";

/** Up to this many lines, a coach post's words show whole in the feed. */
export const NOTE_SHOW_ALL_LINES = 12;
/** Longer: as much as fits in this many lines, ending on a full sentence, then "… more". */
export const NOTE_CUT_LINES = 9;

/** How much of a caption shows before "more": whole up to `all` lines, else cut within `cut`, never at fewer than `min`. */
export type CaptionLimits = { all: number; cut: number; min: number };
const NOTE_LIMITS: CaptionLimits = { all: NOTE_SHOW_ALL_LINES, cut: NOTE_CUT_LINES, min: 3 };
/**
 * Under an automated post's picture: Instagram's short preview (the picture
 * says it; the words open in place). Whole up to 4 lines, else the first
 * clean stop within 3 ("… more").
 */
export const PICTURE_CAPTION_LIMITS: CaptionLimits = { all: 4, cut: 3, min: 1 };

/**
 * A coach post's words in the feed. Short ones (every daily, holiday and
 * birthday post) show whole. A long one stops at the end of a sentence or
 * paragraph, never mid-thought, with "… more" right after it to open the
 * rest in place. Measured at the card's real width, so it's right on every
 * phone. `clamp` off (the post's own page) shows everything. `lead`: the
 * author's name in bold before the words (Instagram's caption, under an
 * automated post's picture), counted in the measuring too. `limits`: how
 * much shows before "more" (PICTURE_CAPTION_LIMITS under a picture).
 */
export function NoteCaption({
  text: typed,
  mentions: typedMentions,
  onOpenPerson,
  clamp,
  lead,
  limits = NOTE_LIMITS,
}: {
  text: string;
  mentions?: CommunityMention[] | null;
  onOpenPerson?: (a: CommunityAuthor) => void;
  clamp: boolean;
  lead?: string | null;
  limits?: CaptionLimits;
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
      if (lead) {
        const name = document.createElement("span");
        name.className = "font-bold";
        name.textContent = lead;
        p.replaceChildren(name, document.createTextNode(` ${t}`));
      } else p.textContent = t;
      return Math.round(p.scrollHeight / lh);
    };
    if (lines(text) <= limits.all) return setCut(null);
    // the longest clean stop that still fits, "… more" included
    const breaks = captionBreaks(text);
    let lo = 0;
    let hi = breaks.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines(previewLine(text, breaks[mid])) <= limits.cut) {
        best = breaks[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    // stopping after a line or two hides the point (a long note): cut by lines instead
    setCut(best > 0 && lines(previewLine(text, best)) >= limits.min ? best : -1);
  }, [text, width, open, clamp, lead, limits]);

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
  const preview = cut !== null && cut > 0 ? cutPreview(text, cut) : null;
  const shown = preview ? preview.shown : text;

  const leadNode = lead ? <span className="font-bold">{lead} </span> : null;
  const tail =
    cut !== null && cut > 0 ? (
      <>
        <span className="text-muted-foreground">{preview?.gap}… </span>
        {more}
      </>
    ) : null;

  return (
    <div ref={box} className="relative">
      {cut === -1 ? (
        // no clean place to stop: as many lines as the limit, then "more" under them
        <p className="whitespace-pre-line text-[15px] leading-[1.45] line-clamp-[9]" style={{ WebkitLineClamp: limits.cut }}>
          {leadNode}
          <MentionText text={shown} mentions={mentions} onOpen={onOpenPerson} />
        </p>
      ) : (
        // whole, or up to a clean stop: its paragraphs as written (CaptionText), "… more" at the end of the last
        <CaptionText text={shown} mentions={mentions} onOpenPerson={onOpenPerson} lead={leadNode} trail={tail} className="text-[15px] leading-[1.5]" />
      )}
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
