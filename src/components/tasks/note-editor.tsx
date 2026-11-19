/**
 * The note editor and row menu shared by Quick notes (private) and Team notes
 * (shared with a group): full screen on a phone, sized to the visual viewport
 * so the keyboard never covers the text, a large centred panel on a computer.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Trash2, ChevronLeft, Copy, Check, Pencil, Files } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { onPhoneLayoutChange, phoneLayoutNow } from "@/lib/portrait-only";

export type SaveState = "idle" | "saving" | "saved" | "error";

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** Not the phone layout (a phone on its side keeps it, portrait-only.ts). */
export function useIsDesktop() {
  const [d, setD] = useState(false);
  useEffect(() => {
    const on = () => setD(!phoneLayoutNow());
    on();
    return onPhoneLayoutChange(on);
  }, []);
  return d;
}

/**
 * A row's ••• menu, opened on tap for touch input. Radix opens on
 * pointerdown, so a swipe or scroll that starts on ••• would pop it open.
 * Mouse and keyboard keep Radix's default behavior.
 */
export function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const touchDown = useRef(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground" aria-label={label}
          onPointerDown={(e) => {
            touchDown.current = e.pointerType !== "mouse";
            // Radix skips its open-on-pointerdown when the event is defaulted.
            if (touchDown.current) e.preventDefault();
          }}
          onClick={() => {
            if (touchDown.current) setOpen(true);
            touchDown.current = false;
          }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A small section label inside a note's menu (sentence case, like every label). */
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-1 pt-1.5 text-xs font-semibold text-muted-foreground">{children}</div>;
}

export function NoteEditor({
  note, saveState, onChange, onClose, onDuplicate, onDelete, menu, chip, backLabel = "Quick Notes",
}: {
  note: { title: string; body: string };
  saveState: SaveState;
  onChange: (patch: { title?: string; body?: string }) => void;
  onClose: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
  /** The top of the ⋯ menu: moving, sharing, the client file. */
  menu: React.ReactNode;
  /** Under the title: the client file, or who the note is shared with. */
  chip?: React.ReactNode;
  /** The ‹ back button's words. */
  backLabel?: string;
}) {
  const isDesktop = useIsDesktop();
  const box = useVisualViewportBox(!isDesktop);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const isNew = !note.title && !note.body;

  // Lock the page behind the editor; Escape closes on desktop.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  // When the keyboard opens/closes the editor resizes — keep the caret line
  // in view so typing near the bottom of a long note never hides under it.
  useEffect(() => {
    const ta = bodyRef.current;
    if (!ta || document.activeElement !== ta) return;
    const end = ta.selectionEnd ?? 0;
    const lineHeight = 28;
    // Height of the text before the caret, measured with an off-screen clone.
    const probe = document.createElement("textarea");
    const cs = getComputedStyle(ta);
    probe.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;height:0;overflow:hidden;width:${ta.clientWidth}px;font:${cs.font};line-height:${cs.lineHeight};padding:${cs.padding};white-space:pre-wrap;word-wrap:break-word;letter-spacing:${cs.letterSpacing}`;
    probe.value = ta.value.slice(0, end);
    document.body.appendChild(probe);
    const caretY = probe.scrollHeight;
    probe.remove();
    if (caretY > ta.scrollTop + ta.clientHeight - lineHeight || caretY < ta.scrollTop + lineHeight) {
      ta.scrollTop = Math.max(0, caretY - ta.clientHeight + lineHeight * 2);
    }
  }, [box?.height]);

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    const ok = await copyText(note.body || note.title);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error("Couldn't copy — select the text instead");
    }
  };

  const status =
    saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save" : saveState === "saved" ? "Saved" : "";

  const mobileStyle: React.CSSProperties | undefined = !isDesktop && box
    ? { top: box.top, height: box.height }
    : undefined;

  const words = note.body.trim() ? note.body.trim().split(/\s+/).length : 0;

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Edit note">
      {/* Desktop backdrop */}
      <div className="absolute inset-0 hidden bg-black/40 backdrop-blur-[2px] md:block" onClick={onClose} />
      <div
        className={cn(
          "absolute inset-x-0 flex flex-col bg-background text-foreground",
          "md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(88vh,960px)] md:w-[min(92vw,820px)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:bg-card md:shadow-2xl md:ring-1 md:ring-border",
          !mobileStyle && "top-0 h-[100dvh]",
        )}
        style={mobileStyle}
      >
        {/* Toolbar */}
        <div
          className="flex shrink-0 items-center gap-1 border-b border-border/70 px-1.5 pb-1.5 md:px-3 md:pt-2"
          style={{ paddingTop: isDesktop ? undefined : "calc(env(safe-area-inset-top) + 0.375rem)" }}
        >
          <Button variant="ghost" className="h-10 gap-0.5 px-2 text-[15px] font-medium text-primary hover:text-primary" onClick={onClose}>
            <ChevronLeft className="h-5 w-5" />{backLabel}
          </Button>
          <span
            className={cn(
              "ml-1 truncate text-[11px] text-muted-foreground transition-opacity duration-300",
              saveState === "error" && "text-destructive",
              !status && "opacity-0",
            )}
            aria-live="polite"
          >
            {status}
          </span>
          <div className="ml-auto flex items-center">
            <Button
              variant="ghost"
              className={cn("h-10 gap-1.5 px-2.5 text-sm font-medium", copied && "text-emerald-600 dark:text-emerald-400")}
              onClick={copy}
              disabled={!note.body && !note.title}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="More note actions">
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[85] w-60">
                {menu}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => window.setTimeout(() => { titleRef.current?.focus(); titleRef.current?.select(); }, 50)}>
                  <Pencil className="mr-2 h-4 w-4" />Rename
                </DropdownMenuItem>
                {onDuplicate && <DropdownMenuItem onClick={onDuplicate}><Files className="mr-2 h-4 w-4" />Duplicate</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                  <Trash2 className="mr-2 h-4 w-4" />Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" className="h-10 px-2.5 text-[15px] font-semibold text-primary hover:text-primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>

        {/* Title + body */}
        <div className="flex min-h-0 flex-1 flex-col px-4 md:px-8">
          <input
            ref={titleRef}
            value={note.title}
            onChange={(e) => onChange({ title: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); bodyRef.current?.focus(); } }}
            placeholder="Title"
            enterKeyHint="next"
            className="w-full shrink-0 bg-transparent pb-2 pt-4 text-[22px] font-bold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50"
          />
          {chip}
          <div className="h-px shrink-0 bg-border/70" />
          <textarea
            ref={bodyRef}
            value={note.body}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder="Start writing…"
            className="min-h-0 w-full flex-1 resize-none overflow-y-auto overscroll-contain bg-transparent pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-[16px] leading-7 outline-none placeholder:text-muted-foreground/50 [scrollbar-gutter:stable]"
            spellCheck
          />
        </div>
        <div className="hidden shrink-0 px-8 pb-3 text-right text-[11px] text-muted-foreground md:block">
          {words.toLocaleString()} {words === 1 ? "word" : "words"}
        </div>
      </div>
    </div>,
    document.body,
  );
}
