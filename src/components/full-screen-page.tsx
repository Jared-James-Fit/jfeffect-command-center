/**
 * The app's full-screen page for interaction (the app-wide standard: a
 * dashboard summarizes, a full-screen page is where you work with something,
 * a compact sheet is for a quick action). It covers the screen, tab bar
 * included, over the page that opened it, which stays mounted underneath, so
 * closing it lands exactly where you were (the scroll and the day you'd
 * picked). One header everywhere: the app's "← Back" pill, the title, then
 * any actions. Back is the pill, Escape, the phone's or browser's Back (the
 * opener keeps the page in the address, see `useFullScreenLayer`) or a swipe
 * right anywhere (`SwipeBack`, which also reveals the page underneath). Its
 * own scroll position is remembered by `id` for the visit, so opening it
 * again lands where you left it.
 *
 * It is deliberately not a dialog (`role="dialog"` would switch SwipeBack off
 * and trap Radix sheets opened from inside it); sheets opened from it portal
 * after it and stack above.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { SwipeBack } from "@/components/swipe-back";

/**
 * Which full-screen page is up, kept in the address (`?layer=plan`) so the
 * phone's or browser's Back closes it and a link can open it. The opener
 * stays mounted underneath: only the search changes, never the route, and the
 * page's scroll is never reset. The route must keep `layer` in its search
 * (validateSearch). Closing goes back when this page pushed the layer (so
 * Back and the pill agree), else it takes the layer off in place.
 */
export function useFullScreenLayer<K extends string>(keys: readonly K[], param = "layer") {
  const router = useRouter();
  const raw = useRouterState({ select: (s) => (s.location.search as Record<string, unknown> | undefined)?.[param] });
  const layer = typeof raw === "string" && (keys as readonly string[]).includes(raw) ? (raw as K) : null;
  const pushed = useRef(false);
  useEffect(() => {
    if (!layer) pushed.current = false;
  }, [layer]);
  const open = useCallback(
    (k: K) => {
      const replace = layer != null; // one layer at a time: switching never stacks Backs
      if (!replace) pushed.current = true;
      void router.navigate({
        to: ".",
        search: ((prev: Record<string, unknown>) => ({ ...(prev ?? {}), [param]: k })) as any,
        replace,
        resetScroll: false,
      } as any);
    },
    [router, param, layer],
  );
  const close = useCallback(() => {
    if (pushed.current && router.history.canGoBack()) {
      pushed.current = false;
      router.history.back();
      return;
    }
    pushed.current = false;
    void router.navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => {
        const { [param]: _drop, ...rest } = prev ?? {};
        return rest;
      }) as any,
      replace: true,
      resetScroll: false,
    } as any);
  }, [router, param]);
  return { layer, open, close };
}

/** Scroll positions for the visit, by page id. */
const scrollMemory = new Map<string, number>();

export function FullScreenPage({
  open,
  id,
  title,
  subtitle,
  actions,
  onBack,
  children,
  className,
  backLabel = "Back",
}: {
  open: boolean;
  /** remembers this page's scroll for the visit */
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  onBack: () => void;
  children: ReactNode;
  className?: string;
  backLabel?: string;
}) {
  const layer = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const backBtn = useRef<HTMLButtonElement | null>(null);
  const back = useRef(onBack);
  back.current = onBack;

  // the page underneath keeps its place: only the document's own scrolling stops while this is up
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const opener = document.activeElement as HTMLElement | null;
    backBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // a sheet or menu open on top closes first
      if (document.querySelector('[role="dialog"][data-state="open"],[role="menu"]')) return;
      back.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open && scroller.current) scroller.current.scrollTop = scrollMemory.get(id) ?? 0;
  }, [open, id]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <>
      {/* going back closes this page: it stays out of sight until it's gone (never slid back in) */}
      <SwipeBack enabled closes target={layer} onBack={() => back.current()} />
      <section
        ref={layer}
        aria-label={typeof title === "string" ? title : undefined}
        className={cn(
          // z-50 like the sheets: portalled after the app's tab bar so it covers it, and sheets opened from it stack above
          "fixed inset-0 z-50 flex flex-col bg-background text-foreground",
          "animate-in fade-in-0 slide-in-from-right-4 duration-200 motion-reduce:animate-none",
          className,
        )}
        data-full-screen={id}
      >
        <header className="shrink-0 border-b border-border/60 bg-background px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:px-6">
          <div className="mx-auto flex min-h-10 max-w-3xl items-center gap-2">
            <button
              ref={backBtn}
              type="button"
              onClick={() => back.current()}
              aria-label={backLabel}
              className="inline-flex h-10 min-w-[44px] shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 text-sm font-semibold text-foreground transition hover:bg-muted active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-full-screen-back
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span className="max-[359px]:sr-only">{backLabel}</span>
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-bold leading-tight tracking-tight">{title}</h1>
              {subtitle ? <p className="truncate text-[12.5px] text-muted-foreground">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
          </div>
        </header>
        <div
          ref={scroller}
          onScroll={(e) => scrollMemory.set(id, (e.currentTarget as HTMLDivElement).scrollTop)}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="mx-auto max-w-3xl px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-3 md:px-6">{children}</div>
        </div>
      </section>
    </>,
    document.body,
  );
}
