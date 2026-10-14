import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from "react";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Editing a sent message, iMessage style: the bubble becomes a roomy pill in
 * place (X to cancel on the left, ✓ to save on the right), the box grows with
 * the text, and the rest of the chat is dimmed by the thread. Used by the
 * coach chat and group chats so both edit the same way.
 *
 * Enter saves on a computer (Shift+Enter for a new line); on a phone Return is
 * a new line and ✓ saves. Esc cancels.
 */
export type MessageEditRowHandle = { focus: () => void };

export const MessageEditRow = forwardRef<MessageEditRowHandle, {
  value: string;
  original: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
  saving?: boolean;
  /** "caption" when the message has photos/videos (shown above the text). */
  label?: string;
  media?: ReactNode;
}>(function MessageEditRow({ value, original, onChange, onCancel, onSave, saving, label, media }, ref) {
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const changed = value.trim() !== (original ?? "").trim();
  const canSave = !!value.trim() && changed && !saving;

  // Grow with the text (up to ~40% of the screen, then it scrolls inside).
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = boxRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      const end = el.value.length;
      try { el.setSelectionRange(end, end); } catch { /* not supported */ }
      // Once the keyboard is up, keep the pill in view above it.
      window.setTimeout(() => rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 320);
    },
  }), []);

  return (
    <div
      ref={rowRef}
      data-edit-row
      className="flex w-full min-w-0 items-center gap-2 py-1 animate-in fade-in zoom-in-95 duration-150"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel edit"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm transition active:scale-90"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1 overflow-hidden rounded-[22px] border border-border bg-card shadow-lg ring-1 ring-primary/25">
        {(label || media) && (
          <div className="flex items-center gap-2 px-4 pt-2.5">
            {media}
            {label && <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>}
          </div>
        )}
        <textarea
          ref={boxRef}
          value={value}
          rows={1}
          enterKeyHint="enter"
          aria-label={label ? `Edit ${label.toLowerCase()}` : "Edit message"}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            const desktop = typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
            if ((desktop && !e.shiftKey) || e.metaKey || e.ctrlKey) {
              e.preventDefault();
              if (canSave) onSave();
            }
          }}
          className="block max-h-[40vh] min-h-[44px] w-full resize-none overflow-y-auto bg-transparent px-4 py-2.5 text-[16px] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        aria-label="Save edit"
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-md transition active:scale-90",
          !canSave && !saving && "opacity-40",
        )}
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" strokeWidth={2.75} />}
      </button>
    </div>
  );
});
