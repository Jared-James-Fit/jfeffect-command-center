import { useLayoutEffect, useRef } from "react";
import { CAPTION_MAX } from "@/lib/community";
import { cn } from "@/lib/utils";

/** Lines the box grows to before it scrolls inside (like a text message). */
const MAX_LINES = 5;
const LINE = 22;

/**
 * The caption box on the dark share screens: one line to start, grows with
 * what you write (up to a few lines, then scrolls), so you can read your
 * sentences back like a text. Return makes a new line.
 */
export function CaptionInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, LINE * MAX_LINES + 22)}px`;
  }, [value]);
  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, CAPTION_MAX))}
        maxLength={CAPTION_MAX}
        rows={1}
        placeholder="Write a caption…"
        aria-label="Caption"
        // 16px keeps iOS from zooming in; 11 + 22 + 11 = the 44px of a single line
        style={{ fontSize: 16, lineHeight: `${LINE}px` }}
        className="block w-full resize-none overflow-y-auto rounded-[22px] border-0 bg-white/10 px-4 py-[11px] text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-white/30"
      />
      {value.length > CAPTION_MAX - 200 && (
        <span className="pointer-events-none absolute -top-4 right-3 text-[10px] tabular-nums text-white/55">
          {value.length}/{CAPTION_MAX}
        </span>
      )}
    </div>
  );
}
