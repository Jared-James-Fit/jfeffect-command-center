import { useLayoutEffect, useRef } from "react";
import { Check, PenLine } from "lucide-react";
import { CAPTION_MAX } from "@/lib/community";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { MentionSuggestBar } from "@/components/community/mentions";

/** A small picture of the post for the caption screen (null if it can't be drawn). */
export function captionThumb(src: HTMLCanvasElement | null | undefined, extra?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): string | null {
  if (!src?.width || !src.height) return null;
  try {
    const c = document.createElement("canvas");
    c.width = 189;
    c.height = Math.round((189 * src.height) / src.width);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    extra?.(ctx, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

/**
 * The caption on a share screen, folded: what you wrote (line breaks and
 * all, first two lines), or "Write a caption…". Tap it to write.
 */
export function CaptionField({ value, onOpen }: { value: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 w-full items-center gap-2.5 rounded-2xl bg-white/10 px-4 py-3 text-left text-[15px] leading-[1.4] ring-1 ring-white/15 active:bg-white/15"
      aria-label={value.trim() ? "Edit caption" : "Write a caption"}
    >
      <PenLine className="h-4 w-4 shrink-0 text-white/60" />
      {value.trim() ? <span className="min-w-0 line-clamp-2 whitespace-pre-wrap break-words">{value.trim()}</span> : <span className="text-white/65">Write a caption…</span>}
    </button>
  );
}

/**
 * Writing the caption, like Instagram's caption screen: the post's preview
 * beside a roomy text area, Return for a new line (space it out however you
 * like; it posts exactly like that), Done to go back. Pinned to the part of
 * the screen above the keyboard, so nothing hides under it.
 */
export function CaptionEditor({ value, onChange, onDone, thumb }: { value: string; onChange: (v: string) => void; onDone: () => void; thumb?: string | null }) {
  const view = useVisualViewportBox(true);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Focus while the tap that opened it is still being handled (iOS only
  // raises the keyboard then), with the caret after what's already there.
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.focus({ preventScroll: true });
    t.setSelectionRange(t.value.length, t.value.length);
  }, []);
  return (
    <div
      className="fixed inset-x-0 z-[75] flex flex-col bg-[#0b0b0d] text-white"
      // keyboard up: just the visible part; otherwise the whole screen (or the desktop dialog)
      style={{ top: view?.keyboard ? view.top : 0, height: view?.keyboard ? view.height : "100%", paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}
      role="dialog"
      aria-label="Caption"
    >
      <div className="relative flex h-11 shrink-0 items-center justify-center px-3">
        <div className="text-[16px] font-black">Caption</div>
        <button type="button" onClick={onDone} className="absolute right-3 inline-flex h-9 items-center gap-1 rounded-full bg-white px-4 text-[14px] font-black text-black active:scale-95">
          <Check className="h-4 w-4" /> Done
        </button>
      </div>
      <div className="mx-4 mt-2 h-px shrink-0 bg-white/10" />
      <div className="flex min-h-0 flex-1 gap-3 px-4 pt-4">
        {thumb && <img src={thumb} alt="" className="h-auto max-h-[112px] w-[63px] shrink-0 self-start rounded-lg object-cover ring-1 ring-white/10" />}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, CAPTION_MAX))}
          maxLength={CAPTION_MAX}
          placeholder="Write a caption…"
          aria-label="Caption"
          enterKeyHint="enter"
          // 17px reads like a message (and keeps iOS from zooming in)
          style={{ fontSize: 17, lineHeight: 1.45 }}
          className="h-full min-h-0 w-full min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-white caret-white outline-none placeholder:text-white/35"
        />
      </div>
      <div
        className="flex shrink-0 items-center gap-2 px-4 pt-2"
        style={{ paddingBottom: view?.keyboard ? "0.5rem" : "max(env(safe-area-inset-bottom), 0.75rem)" }}
      >
        {/* "@" brings up the crew, right above the keyboard */}
        <MentionSuggestBar value={value} onChange={(v) => onChange(v.slice(0, CAPTION_MAX))} inputRef={ref} dark className="min-w-0 flex-1" />
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-white/40">{value.length > 0 && `${value.length}/${CAPTION_MAX}`}</span>
      </div>
    </div>
  );
}
