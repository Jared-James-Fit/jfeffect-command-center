/**
 * The program editor's frame, shared by the template editor and a client's
 * block editor: one sticky header (what you're editing on the left, save /
 * AI / ⋯ on the right) whose second row is the canvas's own toolbar (undo,
 * redo, the weeks), portalled in by StructureCanvas, so the coach always has
 * one bar of controls instead of four stacked ones.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobileNow } from "@/hooks/use-mobile";

export function BuilderHeader({
  back,
  title,
  meta,
  actions,
  onToolbarEl,
}: {
  /** The way out (← to the client or the library). */
  back: ReactNode;
  /** The name (an inline field) of what's being edited. */
  title: ReactNode;
  /** One quiet line under it: whose, its status, how long. */
  meta?: ReactNode;
  /** Save state, Edit with AI, ⋯. */
  actions?: ReactNode;
  /** Where the canvas puts its toolbar (undo / redo / weeks). */
  onToolbarEl?: (el: HTMLDivElement | null) => void;
}) {
  // On a phone the document scrolls while <main> is a scroll box of its own
  // (it clips sideways), so `sticky` never holds there: the header is fixed
  // under the app's bar instead (and follows it up when it slides away,
  // .builder-header-fixed in styles.css), with its room kept in the page.
  const phone = useIsMobileNow();
  const ref = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!phone || !el) return;
    const measure = () => setRoom(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phone]);
  return (
    <>
    <div
      ref={ref}
      data-builder-header
      className={cn(
        "z-30 border-b border-border bg-background",
        phone ? "builder-header-fixed fixed inset-x-0" : "sticky top-0 -mx-2 md:-mx-3",
      )}
    >
      <div className="flex min-h-[52px] items-center gap-1.5 px-2 py-1.5 md:px-3">
        <div className="shrink-0">{back}</div>
        <div className="min-w-0 flex-1">
          {title}
          {meta ? <div className="truncate px-1.5 text-xs text-muted-foreground">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {onToolbarEl ? <div ref={onToolbarEl} data-builder-toolbar-slot className="empty:hidden border-t border-border/70" /> : null}
    </div>
    {phone ? <div aria-hidden style={{ height: room }} data-builder-header-room /> : null}
    </>
  );
}

/** The block / template name, typed straight into the header. */
export function BuilderTitleInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      autoComplete="off"
      className="block h-8 w-full min-w-0 truncate rounded-md bg-transparent px-1.5 text-base font-semibold outline-none transition-colors placeholder:text-muted-foreground hover:bg-muted/60 focus:bg-muted md:text-[15px]"
    />
  );
}

/**
 * A part of the editor the coach opens when they need it (the schedule,
 * the athlete roadmap, warm-ups): one row that opens in place. What's inside
 * only mounts once it's opened, so a closed one costs nothing.
 */
export function BuilderSection({
  id,
  icon,
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  id?: string;
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="scroll-mt-28 rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[52px] w-full items-center gap-2.5 px-4 py-2 text-left"
      >
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
        <span className="shrink-0 text-base font-semibold">{title}</span>
        <span className="min-w-0 flex-1" />
        {/* the hint is for a wide screen; on a phone the title has the row */}
        {hint ? <span className="truncate text-xs text-muted-foreground max-md:hidden">{hint}</span> : null}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="border-t border-border p-3 md:p-4">{children}</div> : null}
    </section>
  );
}

/** One quiet line under the header (amber only when something needs the coach). */
export function BuilderNotice({ icon, tone = "muted", children }: { icon?: ReactNode; tone?: "muted" | "warning"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 px-1 text-[13px] leading-snug",
        tone === "warning" ? "text-warning" : "text-muted-foreground",
      )}
    >
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
